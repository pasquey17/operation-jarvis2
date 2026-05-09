/**
 * Pull image/file URLs from Notion **page body** (block children), with captions
 * from the nearest preceding heading (e.g. "TRADE PHOTO", "Higher time frame Photo").
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

function plainFromRichText(rich) {
  if (!Array.isArray(rich)) return "";
  return rich
    .map((b) => (typeof b?.plain_text === "string" ? b.plain_text : ""))
    .join("")
    .trim();
}

function headingPlainText(block) {
  if (!block?.type?.startsWith?.("heading_")) return "";
  const payload = block[block.type];
  return plainFromRichText(payload?.rich_text);
}

/** Toggle title acts like a caption for charts inside the toggle */
function toggleTitlePlain(block) {
  if (block?.type !== "toggle" || !block.toggle) return "";
  return plainFromRichText(block.toggle.rich_text);
}

function captionSourcePlainText(block) {
  const fromHeading = headingPlainText(block);
  if (fromHeading) return fromHeading;
  return toggleTitlePlain(block);
}

/**
 * @param {string} notionKey
 * @param {string} blockId - page id or block id
 * @param {{ maxItems?: number, maxBlockRequests?: number }} [opts]
 * @returns {Promise<{ url: string, label: string }[]>}
 */
export async function fetchTradeImagesFromNotionPageBlocks(notionKey, blockId, opts = {}) {
  const maxItems = Math.min(
    Math.max(1, Number(opts.maxItems ?? opts.maxUrls) || 48),
    100
  );
  const maxBlockRequests = Math.min(Math.max(1, Number(opts.maxBlockRequests) || 400), 2000);

  const items = [];
  const seen = new Set();
  let blockRequests = 0;
  /** @type {string} */
  let lastHeading = "";

  function pushItem(url, label) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    const cleaned = (label || "").replace(/\s*:\s*$/u, "").trim();
    items.push({ url, label: cleaned });
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
    if (depth > 16 || items.length >= maxItems || blockRequests >= maxBlockRequests) return;

    let cursor = undefined;
    for (;;) {
      const { results, has_more, next_cursor } = await fetchChildrenPage(parentId, cursor);
      for (const block of results) {
        if (items.length >= maxItems || blockRequests >= maxBlockRequests) return;

        const labelLine = captionSourcePlainText(block);
        if (labelLine) lastHeading = labelLine;

        if (block?.type === "image" && block.image) {
          const u = urlFromNotionFileLike(block.image);
          if (u) pushItem(u, lastHeading);
        } else if (block?.type === "file" && block.file) {
          const u = urlFromNotionFileLike(block.file);
          if (u) pushItem(u, lastHeading);
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
  return items;
}

/** @deprecated Use fetchTradeImagesFromNotionPageBlocks for labels */
export async function fetchImageUrlsFromNotionPageBlocks(notionKey, blockId, opts) {
  const rows = await fetchTradeImagesFromNotionPageBlocks(notionKey, blockId, opts);
  return rows.map((r) => r.url);
}
