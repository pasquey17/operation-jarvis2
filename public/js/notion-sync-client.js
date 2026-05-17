/**
 * Background Notion OAuth sync — separate POST so Vercel doesn't kill sync when GET returns.
 * Deduped per user until the in-flight request finishes.
 */

const DEFAULT_USER_ID = "aidenpasque11@gmail.com";

/** @type {{ uid: string, promise: Promise<unknown> } | null} */
let inflight = null;

export function resolveJarvisUserId(explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  try {
    return (
      localStorage.getItem("jarvis_user") ||
      localStorage.getItem("user_id") ||
      DEFAULT_USER_ID
    );
  } catch {
    return DEFAULT_USER_ID;
  }
}

export function isNotionSyncInFlight(userId) {
  const uid = resolveJarvisUserId(userId);
  return inflight?.uid === uid;
}

/**
 * @param {string} [userId]
 * @param {{ onComplete?: (data: object) => void | Promise<void>, onError?: (err: Error) => void }} [options]
 */
export function startNotionAutoSync(userId, options = {}) {
  const uid = resolveJarvisUserId(userId);
  if (inflight && inflight.uid === uid) return inflight.promise;

  const { onComplete, onError } = options;
  const promise = fetch("/api/notion/sync-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: uid }),
    cache: "no-store",
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (typeof data.error === "string" && data.error) ||
          `Notion sync failed (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      if (onComplete) await onComplete(data);
      return data;
    })
    .catch((e) => {
      if (onError) onError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    })
    .finally(() => {
      if (inflight && inflight.uid === uid) inflight = null;
    });

  inflight = { uid, promise };
  return promise;
}
