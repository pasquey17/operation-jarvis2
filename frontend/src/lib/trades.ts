export const DEFAULT_USER_ID = "aidenpasque11@gmail.com";
export const ADELAIDE_TZ = "Australia/Adelaide";

export type TradeLike = Record<string, unknown>;

export function ensureUserId(): string {
  const ju = (localStorage.getItem("jarvis_user") || "").trim();
  const uid = (localStorage.getItem("user_id") || "").trim();
  if (ju) {
    if (uid !== ju) {
      try {
        localStorage.setItem("user_id", ju);
      } catch {}
    }
    return ju;
  }
  if (uid) return uid;
  try {
    localStorage.setItem("jarvis_user", DEFAULT_USER_ID);
    localStorage.setItem("user_id", DEFAULT_USER_ID);
  } catch {}
  return DEFAULT_USER_ID;
}

export function normalizeTradesApiBody(data: unknown): { records: TradeLike[]; snapshot?: any } {
  if (!data || typeof data !== "object") return { records: [] };
  const anyData: any = data as any;
  const inner = anyData.payload && typeof anyData.payload === "object" ? anyData.payload : anyData;
  const trades = Array.isArray(inner.trades) ? inner.trades : null;
  const records = Array.isArray(inner.records) ? inner.records : null;
  const out = (trades || records || []) as TradeLike[];
  return { records: out, snapshot: inner.snapshot };
}

export async function fetchTrades(userId: string) {
  const r = await fetch(`/api/trades?user_id=eq.${encodeURIComponent(userId)}`, { cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  const norm = normalizeTradesApiBody(data);
  return { ok: r.ok, status: r.status, data, records: norm.records, snapshot: norm.snapshot };
}

export function getField(t: TradeLike, ...keys: string[]) {
  for (const k of keys) {
    const v = (t as any)[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

export function outcomeOf(t: TradeLike) {
  const raw = String(getField(t, "outcome", "Outcome", "OUTCOME") || "").trim().toLowerCase();
  if (raw.includes("win") || raw === "w") return "win";
  if (raw.includes("loss") || raw === "l") return "loss";
  if (raw === "be" || raw.includes("break")) return "be";
  return "unk";
}

export function parseDate(value: unknown): Date | null {
  const d = new Date(String(value || ""));
  return isNaN(d.getTime()) ? null : d;
}

export function dateLocalString(dateValue: unknown) {
  const d = parseDate(dateValue);
  if (!d) return "";
  try {
    return d.toLocaleString("en-AU", {
      timeZone: ADELAIDE_TZ,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return d.toString();
  }
}

