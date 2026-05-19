/**
 * intelligence-file.mjs — persistent structured brain layer for Jarvis.
 * Runs the Analysis Engine, structures the results into a clean brain document,
 * and stores it per-user in the intelligence_files Supabase table.
 * The chat layer (step 3) reads from this instead of computing live.
 */

import { runAnalysisEngine } from "./analysis-engine.mjs";

// ─── Supabase helpers ─────────────────────────────────────────────────────────

function sbConfig() {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  return { url, key };
}

async function sbFetch(path, opts = {}) {
  const { url, key } = sbConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  const res = await fetch(`${url}${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Cache-Control": "no-store",
      ...(opts.headers ?? {}),
    },
  });
  return res;
}

async function readRawRow(userId) {
  const res = await sbFetch(
    `/rest/v1/intelligence_files?auth_user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase read failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function upsertFile(userId, file) {
  const { url, key } = sbConfig();
  if (!url || !key) throw new Error("Missing Supabase config");

  const body = {
    auth_user_id: userId,
    user_id: userId,
    report: file,
    generated_at: file.generatedAt,
    trade_count_at_generation: file.tradeCount,
    version: file.version,
  };
  const res = await fetch(`${url}/rest/v1/intelligence_files`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase upsert failed ${res.status}: ${t.slice(0, 200)}`);
  }
}

// ─── Brain document builder ───────────────────────────────────────────────────

function pct(rate) {
  if (rate == null) return "n/a";
  return `${Math.round(rate * 100)}%`;
}

function r2(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function structureIntelligenceReport(raw, userId, existingVersion) {
  const ov = raw.overview ?? {};

  // ── IDENTITY ──────────────────────────────────────────────────────────────

  const pairsByCount = [...(raw.byPair ?? [])].sort((a, b) => b.total - a.total);
  const sessionsByCount = [...(raw.bySession ?? [])].sort((a, b) => b.total - a.total);
  const modelsByCount = [...(raw.byModel ?? [])].sort((a, b) => b.total - a.total);

  const primaryPair = pairsByCount[0]?.key ?? "Unknown";
  const primarySession = sessionsByCount[0]?.key ?? "Unknown";
  const primaryModel = modelsByCount[0]?.key ?? "Unknown";

  const long = raw.byDirection?.find((d) => d.key === "Long");
  const short = raw.byDirection?.find((d) => d.key === "Short");
  let directionBias = "balanced";
  if (long && short) {
    const diff = long.total - short.total;
    if (diff > 15) directionBias = `long-biased (${long.total}L vs ${short.total}S)`;
    else if (diff < -15) directionBias = `short-biased (${short.total}S vs ${long.total}L)`;
    else directionBias = `balanced (${long.total}L / ${short.total}S)`;
  }

  // Infer trading style in plain words
  const topSessionPct = sessionsByCount[0]
    ? Math.round((sessionsByCount[0].total / raw.tradeCount) * 100)
    : 0;
  const topPairPct = pairsByCount[0]
    ? Math.round((pairsByCount[0].total / raw.tradeCount) * 100)
    : 0;

  const styleNotes = [];
  if (topSessionPct >= 70) styleNotes.push(`heavy ${primarySession} session trader (${topSessionPct}% of trades)`);
  if (topPairPct >= 70) styleNotes.push(`primarily ${primaryPair} (${topPairPct}% of trades)`);
  if (modelsByCount.length <= 2) styleNotes.push("narrow model focus");
  else styleNotes.push(`${modelsByCount.length} models in rotation`);
  styleNotes.push(directionBias);

  const identity = {
    primaryInstrument: primaryPair,
    instruments: pairsByCount.map((p) => ({
      pair: p.key,
      trades: p.total,
      winRate: pct(p.winRate),
      totalR: p.totalR,
    })),
    primarySession,
    sessions: sessionsByCount.map((s) => ({
      session: s.key,
      trades: s.total,
      winRate: pct(s.winRate),
    })),
    primaryModel,
    topModels: modelsByCount.slice(0, 4).map((m) => ({
      model: m.key,
      trades: m.total,
      winRate: pct(m.winRate),
      totalR: m.totalR,
    })),
    directionBias,
    tradingStyle: styleNotes.join(", "),
    dataRange: {
      from: ov.firstTrade ?? null,
      to: ov.lastTrade ?? null,
      totalTrades: raw.tradeCount,
    },
  };

  // ── PERFORMANCE ───────────────────────────────────────────────────────────

  const performance = {
    total: ov.total,
    wins: ov.wins,
    losses: ov.losses,
    breakevens: ov.bes,
    decided: ov.decided,
    winRate: pct(ov.winRate),
    winRateRaw: ov.winRate,
    avgRRWin: ov.avgRRWin,
    avgRRLoss: ov.avgRRLoss,
    expectancy: ov.expectancy,
    totalR: ov.totalR,
    bestTrade: ov.bestRR,
    worstTrade: ov.worstRR,
  };

  // ── EDGE MAP ──────────────────────────────────────────────────────────────

  const sessionsQ = (raw.bySession ?? []).filter((s) => s.decided >= 10);
  const daysQ = (raw.byDay ?? []).filter((d) => d.decided >= 10);
  const modelsQ = (raw.byModel ?? []).filter((m) => m.decided >= 10);
  const pairsQ = (raw.byPair ?? []).filter((p) => p.decided >= 10);

  const bestSession = [...sessionsQ].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;
  const bestDay = [...daysQ].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;
  const bestModel = [...modelsQ].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;
  const bestPair = [...pairsQ].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0] ?? null;

  const topCombos = [...(raw.bySessionDay ?? [])]
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .slice(0, 3);

  const edgeMap = {
    bestSession: bestSession
      ? { name: bestSession.key, winRate: pct(bestSession.winRate), trades: bestSession.total, totalR: bestSession.totalR }
      : null,
    bestDay: bestDay
      ? { name: bestDay.key, winRate: pct(bestDay.winRate), trades: bestDay.total, totalR: bestDay.totalR }
      : null,
    bestModel: bestModel
      ? { name: bestModel.key, winRate: pct(bestModel.winRate), trades: bestModel.total, totalR: bestModel.totalR }
      : null,
    bestPair: bestPair
      ? { name: bestPair.key, winRate: pct(bestPair.winRate), trades: bestPair.total, totalR: bestPair.totalR }
      : null,
    bestCombos: topCombos.map((c) => ({
      combo: c.key,
      winRate: pct(c.winRate),
      trades: c.total,
      totalR: c.totalR,
    })),
    strongestEdge: raw.edgeDetection?.strongestEdge ?? null,
    bestTradeFingerprint: raw.edgeDetection?.bestTradeFingerprint ?? [],
  };

  // ── LEAKS ─────────────────────────────────────────────────────────────────

  const worstCombos = [...(raw.bySessionDay ?? [])]
    .filter((c) => c.decided >= 5)
    .sort((a, b) => (a.winRate ?? 1) - (b.winRate ?? 1))
    .slice(0, 3);

  const worstSession = [...sessionsQ].sort((a, b) => (a.winRate ?? 1) - (b.winRate ?? 1))[0] ?? null;
  const worstDay = [...daysQ].sort((a, b) => (a.winRate ?? 1) - (b.winRate ?? 1))[0] ?? null;
  const worstPair = [...(raw.byPair ?? [])]
    .filter((p) => p.decided >= 5)
    .sort((a, b) => (a.winRate ?? 1) - (b.winRate ?? 1))[0] ?? null;
  const worstDirection = [...(raw.byDirection ?? [])]
    .filter((d) => d.decided >= 10)
    .sort((a, b) => (a.winRate ?? 1) - (b.winRate ?? 1))[0] ?? null;

  const leaks = {
    worstCombos: worstCombos.map((c) => ({
      combo: c.key,
      winRate: pct(c.winRate),
      trades: c.total,
      totalR: c.totalR,
    })),
    biggestLeak: raw.edgeDetection?.biggestLeak ?? null,
    worstSession: worstSession
      ? { name: worstSession.key, winRate: pct(worstSession.winRate), trades: worstSession.total, totalR: worstSession.totalR }
      : null,
    worstDay: worstDay
      ? { name: worstDay.key, winRate: pct(worstDay.winRate), trades: worstDay.total, totalR: worstDay.totalR }
      : null,
    weakestPair: worstPair
      ? { name: worstPair.key, winRate: pct(worstPair.winRate), trades: worstPair.total, totalR: worstPair.totalR }
      : null,
    weakestDirection: worstDirection
      ? { name: worstDirection.key, winRate: pct(worstDirection.winRate), trades: worstDirection.total }
      : null,
  };

  // ── FORM ──────────────────────────────────────────────────────────────────

  const sf = raw.streaksAndForm ?? {};
  const streak = sf.currentStreak ?? { type: null, count: 0 };
  const trendWord = sf.vsOverall?.formTrend === "above_average" ? "above average" : "below average";
  const l20 = sf.last20 ?? {};

  const form = {
    currentStreak: streak,
    longestWinStreak: sf.longestWinStreak ?? 0,
    longestLossStreak: sf.longestLossStreak ?? 0,
    last20: {
      tradeCount: l20.tradeCount ?? 0,
      winRate: pct(l20.winRate),
      winRateRaw: l20.winRate,
      totalR: l20.totalR,
    },
    formTrend: sf.vsOverall?.formTrend ?? null,
    winRateDiff: sf.vsOverall?.winRateDiff ?? null,
    summary: streak.type
      ? `On a ${streak.count}-${streak.type} streak. Last 20: ${pct(l20.winRate)} WR, ${l20.totalR ?? 0}R. Form is ${trendWord} (${streak.type === "wins" && (sf.vsOverall?.winRateDiff ?? 0) >= 0 ? "+" : ""}${Math.round((sf.vsOverall?.winRateDiff ?? 0) * 100)}% vs overall).`
      : "No streak data available.",
  };

  // ── DRAWDOWN ─────────────────────────────────────────────────────────────

  const dd = raw.drawdown ?? {};
  const drawdown = {
    maxDrawdownR: dd.maxDrawdownR,
    currentDrawdownR: dd.currentDrawdownR,
    peakR: dd.peakR,
    currentCumulativeR: dd.currentCumulativeR,
    summary: `Peak equity: ${dd.peakR ?? 0}R. Max drawdown ever: ${dd.maxDrawdownR ?? 0}R. Currently ${dd.currentDrawdownR > 0 ? `in ${dd.currentDrawdownR}R drawdown from peak` : "at peak equity"}.`,
  };

  // ── BEHAVIOURAL PATTERNS ──────────────────────────────────────────────────

  const behaviouralPatterns = (raw.notionExtrasPatterns ?? []).map((p) => ({
    attribute: `${p.key}: ${p.value}`,
    count: p.count,
    winRateWith: pct(p.winRateWith),
    winRateWithout: pct(p.winRateWithout),
    diffPct: Math.round(Math.abs(p.diff) * 100),
    positive: p.diff > 0,
    interpretation: `When "${p.key}" = "${p.value}" (n=${p.count}): WR ${pct(p.winRateWith)} vs ${pct(p.winRateWithout)} without — ${p.diff > 0 ? "positive" : "negative"} signal (${Math.round(Math.abs(p.diff) * 100)}pp difference)`,
  }));

  return {
    userId,
    generatedAt: new Date().toISOString(),
    tradeCount: raw.tradeCount,
    version: (existingVersion ?? 0) + 1,
    identity,
    performance,
    edgeMap,
    leaks,
    form,
    drawdown,
    behaviouralPatterns,
  };
}

// ─── Exported API ─────────────────────────────────────────────────────────────

export async function generateIntelligenceFile(userId) {
  if (!userId || typeof userId !== "string") throw new Error("userId required");

  const rawReport = await runAnalysisEngine(userId);

  let existingVersion = 0;
  try {
    const existing = await readRawRow(userId);
    existingVersion = existing?.version ?? 0;
  } catch {
    // no existing row — fine
  }

  const file = structureIntelligenceReport(rawReport, userId, existingVersion);
  await upsertFile(userId, file);
  console.log(
    `[intelligence-file] v${file.version} saved for ${userId} (${file.tradeCount} trades)`
  );
  return file;
}

export async function getIntelligenceFile(userId) {
  if (!userId || typeof userId !== "string") throw new Error("userId required");

  const row = await readRawRow(userId);
  if (row?.report) return row.report;

  // No file yet — generate on demand
  return generateIntelligenceFile(userId);
}

export async function shouldRegenerateIntelligenceFile(userId) {
  let row;
  try {
    row = await readRawRow(userId);
  } catch {
    return true;
  }

  if (!row?.report) return true;

  // Older than 7 days
  if (row.generated_at) {
    const ageMs = Date.now() - new Date(row.generated_at).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) return true;
  }

  // 15+ new trades since last generation
  if (row.trade_count_at_generation != null) {
    try {
      const table = (process.env.SUPABASE_TABLE ?? "trades").trim() || "trades";
      const { url, key } = sbConfig();
      const res = await fetch(
        `${url}/rest/v1/${encodeURIComponent(table)}?auth_user_id=eq.${encodeURIComponent(userId)}&archived=is.false&select=id`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: "count=exact",
            "Cache-Control": "no-store",
            Range: "0-0",
          },
        }
      );
      const cr = res.headers.get("Content-Range") ?? "";
      const m = cr.match(/\/(\d+)$/);
      if (m) {
        const current = parseInt(m[1], 10);
        if (current - (row.trade_count_at_generation ?? 0) >= 15) return true;
      }
    } catch {
      // can't count — don't force regen
    }
  }

  return false;
}
