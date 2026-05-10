/**
 * Notion data_sources/query may return partial pages without `properties`.
 * Retrieve full page JSON when needed so sync can serialize notion_extras.
 */

const DEFAULT_NOTION_API = "https://api.notion.com/v1";

export async function ensureFullNotionPage(
  notionKey,
  page,
  notionApi = DEFAULT_NOTION_API,
  notionVersion = "2025-09-03"
) {
  const props = page?.properties;
  if (props && typeof props === "object" && Object.keys(props).length > 0) {
    return page;
  }
  if (!page?.id) return page;

  const res = await fetch(`${notionApi}/pages/${page.id}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": notionVersion,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(
      `[notion-resolve-page] GET /pages/${page.id} (${res.status}): ${text.slice(0, 240)}`
    );
    return page;
  }
  try {
    return JSON.parse(text);
  } catch {
    return page;
  }
}

/**
 * @param {string} notionKey
 * @param {unknown[]} pages
 * @param {{ notionApi?: string; notionVersion?: string; concurrency?: number }} [options]
 */
export async function resolvePagesWithProperties(notionKey, pages, options = {}) {
  const notionApi = options.notionApi ?? DEFAULT_NOTION_API;
  const notionVersion = options.notionVersion ?? "2025-09-03";
  const concurrency = Math.min(
    12,
    Math.max(1, Number(options.concurrency) || 10)
  );
  const list = Array.isArray(pages) ? pages : [];
  const out = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    const resolved = await Promise.all(
      chunk.map((p) => ensureFullNotionPage(notionKey, p, notionApi, notionVersion))
    );
    out.push(...resolved);
  }
  return out;
}
