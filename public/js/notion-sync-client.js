/**
 * Background Notion OAuth sync — separate POST so Vercel doesn't kill sync when GET returns.
 * Deduped per user until the in-flight request finishes.
 */
import { apiFetch, getAuthUserId } from "./jarvis-auth.js";

/** @type {{ uid: string, promise: Promise<unknown> } | null} */
let inflight = null;

export async function resolveJarvisUserId() {
  return (await getAuthUserId()) || "";
}

export function isNotionSyncInFlight(userId) {
  return inflight?.uid === userId;
}

/**
 * @param {string} [_userId] — ignored; identity from Supabase session
 * @param {{ onComplete?: (data: object) => void | Promise<void>, onError?: (err: Error) => void }} [options]
 */
export function startNotionAutoSync(_userId, options = {}) {
  const uidPromise = resolveJarvisUserId();
  const { onComplete, onError } = options;

  const promise = uidPromise.then(async (uid) => {
    if (!uid) throw new Error("Not signed in");
    if (inflight && inflight.uid === uid) return inflight.promise;

    const run = apiFetch("/api/notion/sync-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
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

    inflight = { uid, promise: run };
    return run;
  });

  return promise;
}
