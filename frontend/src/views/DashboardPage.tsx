import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ensureUserId, fetchTrades } from "../lib/trades";

type Snapshot = {
  total?: number;
  wins?: number;
  losses?: number;
  be?: number;
  winRate?: number | null;
  avgRR?: number | null;
  expectancy?: number | null;
  bestSession?: string | null;
};

type TradeRow = Record<string, unknown>;

export function DashboardPage() {
  const [userId, setUserId] = useState<string>(() => ensureUserId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeRow[]>([]);

  useEffect(() => {
    const u = ensureUserId();
    setUserId(u);
    void load(u);
  }, []);

  const focusLine = useMemo(() => {
    if (!snapshot) return "Syncing stats…";
    if ((snapshot.total || 0) === 0) return "No trades yet — log one clean A+ execution.";
    const wr =
      snapshot.winRate == null ? "—" : Number(snapshot.winRate).toFixed(1) + "%";
    const exp =
      snapshot.expectancy == null
        ? "—"
        : Number(snapshot.expectancy).toFixed(2) + "R";
    return `Win-rate ${wr}. Expectancy ${exp}. Protect your process over outcomes.`;
  }, [snapshot]);

  return (
    <div className="space-y-10">
      <header className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div className="space-y-3">
          <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">
            DASHBOARD
          </p>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-6xl">
            Mission control.
          </h1>
          <p className="max-w-2xl text-pretty text-[15px] leading-[1.7] text-white/70">
            Built on your actual history. No generic advice. Just alignment.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/55">
            USER: {userId}
          </span>
          <a
            href="/app/onboarding/"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/55 transition hover:border-white/20 hover:bg-white/10 hover:text-white/80"
          >
            EDIT PROFILE
          </a>
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
        <Card eyebrow="DAILY FOCUS" meta={loading ? "STREAMING" : error ? "OFFLINE" : "READY"}>
          <p className="text-[15px] leading-[1.7] text-white/78">{focusLine}</p>
          {error && (
            <p className="mt-3 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(255,80,80,0.85)]">
              {error.toUpperCase()}
            </p>
          )}
        </Card>

        <Card eyebrow="KEY METRICS" meta={snapshot?.bestSession ? "LIVE" : "—"}>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="WIN-RATE" value={fmtPct(snapshot?.winRate)} />
            <Metric label="AVG R:R" value={fmtR(snapshot?.avgRR)} />
            <Metric label="EXPECTANCY" value={fmtR(snapshot?.expectancy)} />
            <Metric label="TRADES" value={String(snapshot?.total ?? "—")} />
          </div>
          <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-white/35">
            BEST SESSION: {snapshot?.bestSession || "—"}
          </p>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card eyebrow="AI BRIEFING" meta="CONNECTED">
          <p className="text-[14px] leading-[1.7] text-white/72">
            This panel will call your existing `/api/briefing` endpoint next. For
            now it’s a placeholder while we lock the data adapter across all
            pages.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button as="a" href="/index.html" variant="secondary">
              OPEN CLASSIC CHAT
            </Button>
            <Button as="a" href="/app/pricing/" variant="primary">
              UPGRADE TIER
            </Button>
          </div>
        </Card>

        <Card eyebrow="RECENT TRADES" meta={recentTrades.length ? "LIVE" : "—"}>
          <div className="space-y-3">
            {recentTrades.length === 0 ? (
              <p className="text-[14px] leading-[1.7] text-white/65">
                No trades loaded yet.
              </p>
            ) : (
              recentTrades.slice(0, 6).map((t, idx) => (
                <TradeRowLine key={idx} t={t} />
              ))
            )}
          </div>
        </Card>
      </section>
    </div>
  );

  async function load(u: string) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchTrades(u);
      setSnapshot((r.snapshot || null) as Snapshot | null);
      setRecentTrades(Array.isArray(r.records) ? r.records.slice(0, 10) : []);
      if (!r.ok) {
        const msg =
          r.data && typeof r.data === "object" && typeof (r.data as any).error === "string"
            ? String((r.data as any).error)
            : `HTTP ${r.status}`;
        setError(msg);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-black/20 p-4">
      <p className="font-mono text-[9px] tracking-[0.18em] text-white/40">
        {label}
      </p>
      <p className="mt-2 font-mono text-[16px] tracking-[0.08em] text-white/85">
        {value}
      </p>
    </div>
  );
}

function TradeRowLine({ t }: { t: TradeRow }) {
  const pair = String((t as any).pair || (t as any).Pair || (t as any).symbol || "—").toUpperCase();
  const outcome = String((t as any).outcome || (t as any).Outcome || "—").toUpperCase();
  const rr = (t as any).rr ?? (t as any).RR ?? "";
  const model = String((t as any).model || (t as any).Model || (t as any)["ENTRY MODEL"] || "—");
  const badge =
    outcome.includes("WIN") ? "bg-[color:rgba(0,255,136,0.16)] text-[color:rgba(0,255,136,0.92)] border-[color:rgba(0,255,136,0.26)]"
      : outcome.includes("LOSS") ? "bg-[color:rgba(255,80,80,0.16)] text-[color:rgba(255,80,80,0.92)] border-[color:rgba(255,80,80,0.26)]"
        : "bg-white/5 text-white/70 border-white/10";

  return (
    <div className="flex items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-black/20 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={"rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] " + badge}>
            {outcome}
          </span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-white/55">
            {pair}
          </span>
        </div>
        <p className="mt-2 truncate text-[13px] text-white/70" title={model}>
          {model}
        </p>
      </div>
      <span className="font-mono text-[11px] tracking-[0.12em] text-white/70">
        {String(rr || "—")}
      </span>
    </div>
  );
}

function fmtPct(v: number | null | undefined) {
  return v == null ? "—" : Number(v).toFixed(1) + "%";
}
function fmtR(v: number | null | undefined) {
  return v == null ? "—" : Number(v).toFixed(2) + "R";
}

