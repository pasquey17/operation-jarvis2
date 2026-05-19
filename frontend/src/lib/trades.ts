import { apiFetch, getAuthUserId } from "./jarvisAuth";

export const ADELAIDE_TZ = "Australia/Adelaide";

export type TradeLike = Record<string, unknown>;

export async function ensureUserId(): Promise<string> {
  return (await getAuthUserId()) || "";
}

export function normalizeTradesApiBody(data: unknown): { records: TradeLike[]; snapshot?: unknown } {
  if (!data || typeof data !== "object") return { records: [] };
  const anyData = data as Record<string, unknown>;
  const inner =
    anyData.payload && typeof anyData.payload === "object"
      ? (anyData.payload as Record<string, unknown>)
      : anyData;
  const trades = Array.isArray(inner.trades) ? inner.trades : null;
  const records = Array.isArray(inner.records) ? inner.records : null;
  const out = (trades || records || []) as TradeLike[];
  return { records: out, snapshot: inner.snapshot };
}

export async function fetchTrades(_userId?: string) {
  const r = await apiFetch("/api/trades");
  const data = await r.json().catch(() => ({}));
  const norm = normalizeTradesApiBody(data);
  return { ok: r.ok, status: r.status, data, records: norm.records, snapshot: norm.snapshot };
}

export function getField(t: TradeLike, ...keys: string[]) {
  for (const k of keys) {
    const v = t[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

export function outcomeOf(t: TradeLike) {
  const raw = String(getField(t, "outcome", "Outcome", "OUTCOME") || "")
    .trim()
    .toLowerCase();
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
