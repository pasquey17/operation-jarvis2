/**
 * Supabase Auth verification for Jarvis API routes.
 * Identity comes from the Bearer JWT — never from client-supplied user_id.
 */

const AUTH_PUBLIC_PATHS = [
  "/api/notion/callback",
  "/api/notion/connect",
  "/api/ping",
  "/api/proxy-image",
  "/api/admin/users",
  "/api/admin/dev-login",
];

/** Legacy email → auth UUID (migration / Notion OAuth state fallback). */
export const EMAIL_TO_AUTH_USER_ID = Object.freeze({
  "aidenpasque11@gmail.com": "e7b15ce6-13d2-488c-87f6-02eccb326641",
  "spasque70@gmail.com": "d850b484-0fff-4bf0-8900-44c865472390",
});

export const AUTH_USER_ID_AIDEN = EMAIL_TO_AUTH_USER_ID["aidenpasque11@gmail.com"];
export const AUTH_USER_ID_MUM = EMAIL_TO_AUTH_USER_ID["spasque70@gmail.com"];

export const OAUTH_BOOT_AUTH_USER_IDS = [AUTH_USER_ID_AIDEN, AUTH_USER_ID_MUM];

export function isPublicApiPath(pathname) {
  const p = pathname.split("?")[0];
  return AUTH_PUBLIC_PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}?`));
}

export function extractBearerToken(req) {
  const raw = req.headers?.authorization || req.headers?.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return m ? m[1].trim() : "";
}

/**
 * Verify Supabase access token → { authUserId, email }.
 * @returns {Promise<{ authUserId: string, email: string | null } | null>}
 */
export async function verifyRequestAuth(req) {
  const token = extractBearerToken(req);
  if (!token) return null;

  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() || "";
  if (!url || !anonKey) return null;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const authUserId = typeof data?.id === "string" ? data.id.trim() : "";
    if (!authUserId) return null;
    const email =
      typeof data?.email === "string" && data.email.trim() ? data.email.trim() : null;
    return { authUserId, email };
  } catch {
    return null;
  }
}

/**
 * Resolve OAuth `state` to auth UUID (supports legacy email state values).
 * @param {string | null | undefined} state
 * @returns {string | null}
 */
export function resolveAuthUserIdFromOAuthState(state) {
  const s = state ? decodeURIComponent(String(state)).trim() : "";
  if (!s) return null;
  if (s.includes("@")) return EMAIL_TO_AUTH_USER_ID[s.toLowerCase()] ?? null;
  return s;
}

/** Dormant legacy email for rows that still carry user_id TEXT. */
export function legacyEmailForAuthUserId(authUserId, authEmail) {
  for (const [email, id] of Object.entries(EMAIL_TO_AUTH_USER_ID)) {
    if (id === authUserId) return email;
  }
  return authEmail || null;
}
