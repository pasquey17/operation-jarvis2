import { runNotionSync } from "./notion-sync.mjs";

/**
 * Minimal handler for GET /api/sync
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<boolean>} true if handled
 */
export async function handleApiSync(req, res) {
  if (req.method !== "GET" || !req.url?.startsWith("/api/sync")) return false;

  await runNotionSync();

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ success: true }));
  return true;
}

