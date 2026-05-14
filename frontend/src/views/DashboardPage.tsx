import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
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

const ease = [0.22, 1, 0.36, 1] as const;

function useCountUp(target: number | null | undefined, duration = 800) {
  const [value, setValue] = useState(0);
  const frame = useRef<number>(0);
  useEffect(() => {
    if (target == null) return;
    const tgt = target;
    const start = performance.now();
    function step(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setValue(tgt * ease);
      if (t < 1) frame.current = requestAnimationFrame(step);
    }
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, duration]);
  return value;
}

function useTypingText(lines: string[], speed = 28) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!lines.length) return;
    const full = lines.join(" ");
    let i = 0;
    setDisplayed("");
    setDone(false);
    const iv = setInterval(() => {
      i++;
      setDisplayed(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(iv);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(iv);
  }, [lines.join("|"), speed]);
  return { displayed, done };
}

export function DashboardPage() {
  const [userId] = useState<string>(() => ensureUserId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradeRow[]>([]);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  const winRateVal = useCountUp(snapshot?.winRate, 900);
  const avgRRVal = useCountUp(snapshot?.avgRR, 900);
  const expectancyVal = useCountUp(snapshot?.expectancy, 900);
  const totalVal = useCountUp(snapshot?.total, 700);

  const briefingLines = useMemo(() => {
    if (briefingLoading) return ["// LOADING BRIEFING…"];
    if (briefing) return [briefing];
    return [];
  }, [briefing, briefingLoading]);

  const { displayed: typedBriefing, done: briefingDone } = useTypingText(briefingLines, 18);

  useEffect(() => {
    void load(userId);
  }, [userId]);

  async function loadBriefing(u: string) {
    setBriefingLoading(true);
    setBriefing(null);
    try {
      const r = await fetch("/api/briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: u }),
        cache: "no-store",
      });
      if (r.ok) {
        const data = await r.json();
        const text = typeof data === "string" ? data : (data as any).briefing || (data as any).content || JSON.stringify(data);
        setBriefing(text);
      } else {
        setBriefing("Briefing unavailable — check your API connection.");
      }
    } catch {
      setBriefing("Could not reach briefing endpoint.");
    } finally {
      setBriefingLoading(false);
    }
  }

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

  const focusLine = useMemo(() => {
    if (!snapshot) return "Syncing stats…";
    if ((snapshot.total || 0) === 0) return "No trades yet — log one clean A+ execution.";
    const wr = snapshot.winRate == null ? "—" : Number(snapshot.winRate).toFixed(1) + "%";
    const exp = snapshot.expectancy == null ? "—" : Number(snapshot.expectancy).toFixed(2) + "R";
    return `Win-rate ${wr}. Expectancy ${exp}. Protect your process over outcomes.`;
  }, [snapshot]);

  return (
    <div className="space-y-10">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
        className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end"
      >
        <div className="space-y-3">
          <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">DASHBOARD</p>
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
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.1, ease }}
        className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]"
      >
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
            <CountMetric
              label="WIN-RATE"
              value={snapshot?.winRate == null ? "—" : winRateVal.toFixed(1) + "%"}
            />
            <CountMetric
              label="AVG R:R"
              value={snapshot?.avgRR == null ? "—" : avgRRVal.toFixed(2) + "R"}
            />
            <CountMetric
              label="EXPECTANCY"
              value={snapshot?.expectancy == null ? "—" : expectancyVal.toFixed(2) + "R"}
            />
            <CountMetric
              label="TRADES"
              value={snapshot?.total == null ? "—" : Math.round(totalVal).toString()}
            />
          </div>
          <p className="mt-4 font-mono text-[10px] tracking-[0.18em] text-white/35">
            BEST SESSION: {snapshot?.bestSession || "—"}
          </p>
        </Card>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.2, ease }}
        className="grid gap-6 md:grid-cols-2"
      >
        <Card eyebrow="AI BRIEFING" meta={briefingLoading ? "STREAMING" : briefing ? "READY" : "STANDBY"}>
          {!briefing && !briefingLoading && (
            <>
              <p className="text-[14px] leading-[1.7] text-white/65">
                Request your morning briefing — Jarvis will analyse your recent trades and surface today's focus.
              </p>
              <div className="mt-4">
                <Button
                  as="button"
                  variant="primary"
                  onClick={() => loadBriefing(userId)}
                >
                  GENERATE BRIEFING
                </Button>
              </div>
            </>
          )}
          {(briefingLoading || briefing) && (
            <div className="space-y-3">
              <p className="font-mono text-[12px] leading-[1.8] text-white/80 whitespace-pre-wrap">
                {typedBriefing}
                {!briefingDone && (
                  <span className="ml-px inline-block h-[1em] w-[2px] animate-[pulse_0.8s_step-end_infinite] bg-[color:rgba(0,212,255,0.85)] align-middle" />
                )}
              </p>
              {briefingDone && (
                <Button
                  as="button"
                  variant="secondary"
                  onClick={() => loadBriefing(userId)}
                >
                  REFRESH
                </Button>
              )}
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button as="a" href="/index.html" variant="secondary">
              OPEN CLASSIC CHAT
            </Button>
          </div>
        </Card>

        <Card eyebrow="RECENT TRADES" meta={recentTrades.length ? "LIVE" : "—"}>
          <div className="space-y-3">
            {recentTrades.length === 0 ? (
              <p className="text-[14px] leading-[1.7] text-white/65">No trades loaded yet.</p>
            ) : (
              recentTrades.slice(0, 6).map((t, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: idx * 0.06, ease }}
                >
                  <TradeRowLine t={t} />
                </motion.div>
              ))
            )}
          </div>
        </Card>
      </motion.section>
    </div>
  );
}

function CountMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-black/20 p-4">
      <p className="font-mono text-[9px] tracking-[0.18em] text-white/40">{label}</p>
      <p className="mt-2 font-mono text-[16px] tracking-[0.08em] text-[color:rgba(0,212,255,0.9)]">
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
    outcome.includes("WIN")
      ? "bg-[color:rgba(0,255,136,0.16)] text-[color:rgba(0,255,136,0.92)] border-[color:rgba(0,255,136,0.26)]"
      : outcome.includes("LOSS")
        ? "bg-[color:rgba(255,80,80,0.16)] text-[color:rgba(255,80,80,0.92)] border-[color:rgba(255,80,80,0.26)]"
        : "bg-white/5 text-white/70 border-white/10";

  return (
    <div className="flex items-center justify-between gap-3 rounded-[16px] border border-white/10 bg-black/20 px-4 py-3 transition hover:border-[color:rgba(0,212,255,0.2)] hover:bg-[color:rgba(0,212,255,0.04)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={"rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] " + badge}>
            {outcome}
          </span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-white/55">{pair}</span>
        </div>
        <p className="mt-2 truncate text-[13px] text-white/70" title={model}>{model}</p>
      </div>
      <span className="font-mono text-[11px] tracking-[0.12em] text-[color:rgba(0,212,255,0.75)]">
        {String(rr || "—")}
      </span>
    </div>
  );
}
