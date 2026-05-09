/**
 * Pull image/file URLs from Notion **page body** (block children), not only DB properties.
 * Covers image blocks and file blocks under headings like "TRADE PHOTO:".
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";

function urlFromNotionFileLike(obj) {
  if (!obj || typeof obj !== "object") return "";
  if (typeof obj.external?.url === "string") return String(obj.external.url).trim();
  if (typeof obj.file?.url === "string") return String(obj.file.url).trim();
  if (obj.type === "external" && obj.external?.url) return String(obj.external.url).trim();
  if (obj.type === "file" && obj.file?.url) return String(obj.file.url).trim();
  return "";
}

/**
 * @param {string} notionKey
 * @param {string} blockId - page id or block id
 * @param {{ maxUrls?: number, maxBlockRequests?: number }} [opts]
 * @returns {Promise<string[]>}
 */
export async function fetchImageUrlsFromNotionPageBlocks(notionKey, blockId, opts = {}) {
  const maxUrls = Math.min(Math.max(1, Number(opts.maxUrls) || 48), 100);
  const maxBlockRequests = Math.min(Math.max(1, Number(opts.maxBlockRequests) || 400), 2000);

  const urls = [];
  const seen = new Set();
  let blockRequests = 0;

  function pushUrl(u) {
    if (!u || !/^https?:\/\//i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  }

  async function fetchChildrenPage(parentId, startCursor) {
    if (blockRequests >= maxBlockRequests) return { results: [], has_more: false, next_cursor: null };
    blockRequests += 1;
    const u = new URL(`${NOTION_API}/blocks/${parentId}/children`);
    u.searchParams.set("page_size", "100");
    if (startCursor) u.searchParams.set("start_cursor", startCursor);

    const res = await fetch(u.toString(), {
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Notion block children failed (${res.status}): ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Notion blocks returned invalid JSON");
    }
    return {
      results: Array.isArray(data.results) ? data.results : [],
      has_more: Boolean(data.has_more),
      next_cursor: data.next_cursor || null,
    };
  }

  async function walk(parentId, depth) {
    if (depth > 16 || urls.length >= maxUrls || blockRequests >= maxBlockRequests) return;

    let cursor = undefined;
    for (;;) {
      const { results, has_more, next_cursor } = await fetchChildrenPage(parentId, cursor);
      for (const block of results) {
        if (urls.length >= maxUrls || blockRequests >= maxBlockRequests) return;

        if (block?.type === "image" && block.image) {
          const u = urlFromNotionFileLike(block.image);
          if (u) pushUrl(u);
        } else if (block?.type === "file" && block.file) {
          const u = urlFromNotionFileLike(block.file);
          if (u) pushUrl(u);
        }

        if (block?.has_children && block.id) {
          await walk(block.id, depth + 1);
        }
      }

      if (!has_more || !next_cursor) break;
      cursor = next_cursor;
    }
  }

  await walk(blockId, 0);
  return urls;
}
