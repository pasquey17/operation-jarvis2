const CONNECT_PATH = "/api/notion/connect";

/** Absolute HTTPS (or localhost HTTP) URL to start Notion OAuth via Jarvis — never notion:// */
export function buildNotionConnectUrl(userId: string): string {
  const id = String(userId ?? "").trim();
  if (!id) {
    throw new Error("Missing user id for Notion OAuth");
  }

  const url = new URL(CONNECT_PATH, window.location.origin);
  url.searchParams.set("user_id", id);
  const href = url.toString();

  if (href.startsWith("notion:")) {
    throw new Error("Invalid Notion OAuth URL scheme");
  }
  if (!href.startsWith("http://") && !href.startsWith("https://")) {
    throw new Error("Notion OAuth URL must be an absolute HTTP(S) address");
  }

  return href;
}

/** Navigate to Notion OAuth in the current tab so the user lands on notion-setup.html after auth. */
export function openNotionOAuthConnect(userId: string): void {
  const href = buildNotionConnectUrl(userId);
  window.location.href = href;
}
