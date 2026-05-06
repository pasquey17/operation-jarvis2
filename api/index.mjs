/**
 * Vercel entry: rewrites send all traffic here with the original path in `__v_path`
 * so the monolithic `server.mjs` still sees `req.url` as on a long-lived server.
 */
import handler from "../server.mjs";

const ROUTING_PARAM = "__v_path";

function restoreOriginalUrl(req) {
  try {
    const host = req.headers.host ?? "localhost";
    const u = new URL(req.url ?? "/", `http://${host}`);
    const raw = u.searchParams.get(ROUTING_PARAM);
    const sp = new URLSearchParams(u.searchParams);
    sp.delete(ROUTING_PARAM);
    const qs = sp.toString();

    if (raw !== null) {
      let segment = raw === "" ? "" : raw;
      if (segment !== "") {
        try {
          segment = decodeURIComponent(raw);
        } catch {
          /* keep raw URL segment */
        }
      }
      const pathname = segment === "" || segment === "/" ? "/" : segment.startsWith("/") ? segment : `/${segment}`;
      req.url = pathname + (qs ? `?${qs}` : "");
      return;
    }

    if (u.pathname === "/api" || u.pathname === "/api/index") {
      req.url = "/" + (qs ? `?${qs}` : "");
    }
  } catch {
    req.url = "/";
  }
}

export default function vercelEntry(req, res) {
  restoreOriginalUrl(req);
  return handler(req, res);
}
