/**
 * analysis-engine.mjs — pure-JS statistical intelligence engine for Jarvis.
 * No AI, no API calls, no tokens. Fetches all trades for a user_id from
 * Supabase and returns a structured intelligence report.
 */

const ADELAIDE_TZ = "Australia/Adelaide";

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-AU", {
  timeZone: ADELAIDE_TZ,
  weekday: "long",
});

const ORDERED_DAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

// Keys that are already core columns — skip them in notion_extras pattern analysis
const SKIP_NE_KEYS = new Set([
  "session", "outcome", "rr", "model", "pair", "direction", "weekday",
  "date", "date_local", "notes", "account", "notion_id", "notion_url",
  "trade_images", "id", "user_id", "created_at", "updated_at",
  "notion_last_edited", "archived", "notion_sync_source",
  "Name", "name", "title", "Title", "URL", "url",
]);

// ─── Low-level helpers ────────────────────────────────────────────────────────

function adelaideWeekday(dateVal) {
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    return WEEKDAY_FMT.format(d);
  } catch {
    return null;
  }
}

function normOutcome(t) {
  return String(t?.outcome ?? "").trim().toLowerCase();
}

function isWin(o) { return o.includes("win"); }
function isLoss(o) { return o.includes("loss"); }

function getRR(t) {
  const n = Number(t?.rr);
  return Number.isFinite(n) ? n : null;
}

function getWeekday(t) {
  const wk = t?.weekday;
  if (wk && typeof wk === "string" && wk.trim()) return wk.trim();
  return adelaideWeekday(t?.date) ?? "Unknown";
}

function round2(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

// ─── Core stat computation ────────────────────────────────────────────────────

function groupStats(trades) {
  let wins = 0, losses = 0, bes = 0;
  let rrWinSum = 0, rrWinCt = 0;
  let rrLossSum = 0, rrLossCt = 0;
  let totalR = 0;
  let best = -Infinity, worst = Infinity;

  for (const t of trades) {
    const o = normOutcome(t);
    const rr = getRR(t);
    if (isWin(o)) {
      wins++;
      if (rr !== null) {
        rrWinSum += rr; rrWinCt++;
        totalR += rr;
        if (rr > best) best = rr;
      }
    } else if (isLoss(o)) {
      losses++;
      if (rr !== null) {
        rrLossSum += rr; rrLossCt++;
        totalR += rr;
        if (rr < worst) worst = rr;
      }
    } else {
      bes++;
    }
  }

  const decided = wins + losses;
  const winRate = decided > 0 ? round2(wins / decided) : null;
  const avgRRWin = rrWinCt > 0 ? round2(rrWinSum / rrWinCt) : null;
  const avgRRLoss = rrLossCt > 0 ? round2(rrLossSum / rrLossCt) : null;
  const expectancy =
    winRate !== null && avgRRWin !== null && avgRRLoss !== null
      ? round2(winRate * avgRRWin + (1 - winRate) * avgRRLoss)
      : null;

  return {
    total: trades.length,
    wins,
    losses,
    bes,
    decided,
    winRate,
    avgRRWin,
    avgRRLoss,
    totalR: round2(totalR),
    expectancy,
    bestRR: best !== -Infinity ? round2(best) : null,
    worstRR: worst !== Infinity ? round2(worst) : null,
  };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchAllTradesForAnalysis(userId) {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  const table = (process.env.SUPABASE_TABLE ?? "trades").trim() || "trades";

  if (!url || !key) throw new Error("Missing SUPABASE_URL or Supabase key env vars");

  const endpoint =
    `${url}/rest/v1/${encodeURIComponent(table)}` +
    `?select=*&user_id=eq.${encodeURIComponent(userId)}&archived=is.false&order=date.asc`;

  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Cache-Control": "no-store",
      Range: "0-4999",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("Supabase did not return an array");
  return rows;
}

// ─── Grouping utilities ───────────────────────────────────────────────────────

function groupBy(trades, keyFn) {
  const map = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (k === null || k === undefined || k === "") continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
}

function mapToStatRows(map, sortBy = "totalR") {
  const rows = [];
  for (const [key, ts] of map.entries()) {
    rows.push({ key, ...groupStats(ts) });
  }
  rows.sort((a, b) => (b[sortBy] ?? -Infinity) - (a[sortBy] ?? -Infinity));
  return rows;
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildOverview(trades) {
  const stats = groupStats(trades);
  const dates = trades.map((t) => t.date).filter(Boolean).sort();
  return {
    ...stats,
    firstTrade: dates[0] ?? null,
    lastTrade: dates[dates.length - 1] ?? null,
  };
}

function buildBySession(trades) {
  const map = groupBy(trades, (t) => (t.session ?? "").trim() || null);
  return mapToStatRows(map);
}

function buildByDay(trades) {
  const map = groupBy(trades, (t) => {
    const d = getWeekday(t);
    return d === "Unknown" ? null : d;
  });
  const rows = mapToStatRows(map);
  const dayOrder = Object.fromEntries(ORDERED_DAYS.map((d, i) => [d, i]));
  rows.sort((a, b) => (dayOrder[a.key] ?? 99) - (dayOrder[b.key] ?? 99));
  return rows;
}

function buildBySessionDay(trades) {
  const map = groupBy(trades, (t) => {
    const s = (t.session ?? "").trim();
    const d = getWeekday(t);
    if (!s || d === "Unknown") return null;
    return `${s} ${d}`;
  });
  const rows = [];
  for (const [key, ts] of map.entries()) {
    if (ts.length < 5) continue;
    rows.push({ key, ...groupStats(ts) });
  }
  rows.sort((a, b) => (b.totalR ?? -Infinity) - (a.totalR ?? -Infinity));
  return rows;
}

function buildByModel(trades) {
  const map = groupBy(trades, (t) => (t.model ?? "").trim() || null);
  return mapToStatRows(map);
}

function buildByPair(trades) {
  const map = groupBy(trades, (t) => (t.pair ?? "").trim() || null);
  return mapToStatRows(map);
}

function buildByDirection(trades) {
  const map = groupBy(trades, (t) => {
    const d = (t.direction ?? "").trim().toLowerCase();
    if (d.includes("long") || d === "buy") return "Long";
    if (d.includes("short") || d === "sell") return "Short";
    if (d) return d.charAt(0).toUpperCase() + d.slice(1);
    return null;
  });
  return mapToStatRows(map);
}

function buildStreaksAndForm(trades) {
  const outcomes = trades.map((t) => {
    const o = normOutcome(t);
    if (isWin(o)) return "W";
    if (isLoss(o)) return "L";
    return "B";
  });

  let maxWinStreak = 0, maxLossStreak = 0;
  let curWin = 0, curLoss = 0;
  for (const o of outcomes) {
    if (o === "W") { curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
    else if (o === "L") { curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
    else { curWin = 0; curLoss = 0; }
  }

  // Current streak from the end of the sorted list
  let currentStreak = { type: null, count: 0 };
  if (outcomes.length > 0) {
    const last = outcomes[outcomes.length - 1];
    if (last === "W" || last === "L") {
      currentStreak.type = last === "W" ? "wins" : "losses";
      let n = 1;
      for (let i = outcomes.length - 2; i >= 0; i--) {
        if (outcomes[i] === last) n++;
        else break;
      }
      currentStreak.count = n;
    }
  }

  const last20 = trades.slice(-20);
  const last20Stats = groupStats(last20);
  const overallStats = groupStats(trades);

  const winRateDiff =
    last20Stats.winRate !== null && overallStats.winRate !== null
      ? round2(last20Stats.winRate - overallStats.winRate)
      : null;

  return {
    currentStreak,
    longestWinStreak: maxWinStreak,
    longestLossStreak: maxLossStreak,
    last20: {
      tradeCount: last20.length,
      winRate: last20Stats.winRate,
      totalR: last20Stats.totalR,
    },
    vsOverall: {
      winRateDiff,
      formTrend:
        winRateDiff !== null
          ? winRateDiff >= 0 ? "above_average" : "below_average"
          : null,
    },
  };
}

function buildDrawdown(trades) {
  let peak = 0, cumulativeR = 0;
  let maxDrawdown = 0;

  for (const t of trades) {
    const rr = getRR(t);
    const o = normOutcome(t);
    if (rr !== null && (isWin(o) || isLoss(o))) {
      cumulativeR += rr;
      if (cumulativeR > peak) peak = cumulativeR;
      const dd = peak - cumulativeR;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  return {
    maxDrawdownR: round2(maxDrawdown),
    currentDrawdownR: round2(Math.max(0, peak - cumulativeR)),
    peakR: round2(peak),
    currentCumulativeR: round2(cumulativeR),
  };
}

function buildEdgeDetection(trades) {
  const candidates = [];

  const addGroup = (label, ts) => {
    if (ts.length < 10) return;
    const s = groupStats(ts);
    if (s.winRate === null) return;
    candidates.push({ label, total: s.total, winRate: s.winRate, totalR: s.totalR });
  };

  for (const [key, ts] of groupBy(trades, (t) => (t.session ?? "").trim() || null)) {
    addGroup(`Session: ${key}`, ts);
  }
  for (const [key, ts] of groupBy(trades, (t) => {
    const d = getWeekday(t);
    return d === "Unknown" ? null : d;
  })) {
    addGroup(`Day: ${key}`, ts);
  }
  for (const [key, ts] of groupBy(trades, (t) => {
    const s = (t.session ?? "").trim();
    const d = getWeekday(t);
    if (!s || d === "Unknown") return null;
    return `${s} ${d}`;
  })) {
    addGroup(key, ts);
  }
  for (const [key, ts] of groupBy(trades, (t) => (t.model ?? "").trim() || null)) {
    addGroup(`Model: ${key}`, ts);
  }

  if (candidates.length === 0) {
    return { strongestEdge: null, biggestLeak: null, bestTradeFingerprint: [] };
  }

  candidates.sort((a, b) => b.winRate - a.winRate);
  const strongestEdge = candidates[0];
  const biggestLeak = candidates[candidates.length - 1];

  // Best trade fingerprint — top 10 by RR
  const top10 = [...trades]
    .filter((t) => getRR(t) !== null)
    .sort((a, b) => (getRR(b) ?? 0) - (getRR(a) ?? 0))
    .slice(0, 10);

  const freq = new Map();
  const inc = (k, v) => {
    if (!v || !String(v).trim()) return;
    const key = `${k}: ${v}`;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  };

  for (const t of top10) {
    inc("session", (t.session ?? "").trim());
    inc("model", (t.model ?? "").trim());
    inc("direction", (t.direction ?? "").trim());
    inc("weekday", getWeekday(t));
    inc("pair", (t.pair ?? "").trim());
    const ne = t.notion_extras;
    if (ne && typeof ne === "object" && !Array.isArray(ne)) {
      for (const [k, v] of Object.entries(ne)) {
        if (SKIP_NE_KEYS.has(k)) continue;
        for (const val of extractNotionValues(v)) {
          inc(k, val);
        }
      }
    }
  }

  const fingerprint = [...freq.entries()]
    .filter(([, ct]) => ct >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([attribute, count]) => ({
      attribute,
      count,
      pct: round2(count / top10.length),
    }));

  return {
    strongestEdge: {
      label: strongestEdge.label,
      tradeCount: strongestEdge.total,
      winRate: strongestEdge.winRate,
      totalR: strongestEdge.totalR,
    },
    biggestLeak: {
      label: biggestLeak.label,
      tradeCount: biggestLeak.total,
      winRate: biggestLeak.winRate,
      totalR: biggestLeak.totalR,
    },
    bestTradeFingerprint: fingerprint,
  };
}

function extractNotionValues(prop) {
  if (prop === null || prop === undefined) return [];
  if (typeof prop === "string") return prop.trim() ? [prop.trim().slice(0, 80)] : [];
  if (typeof prop === "number") return [String(prop)];
  if (typeof prop === "boolean") return [String(prop)];
  if (!prop || typeof prop !== "object") return [];
  if (Array.isArray(prop)) {
    return prop.flatMap((v) => extractNotionValues(v)).filter(Boolean);
  }
  // Notion property type wrappers
  if (prop.select?.name) return [String(prop.select.name)];
  if (Array.isArray(prop.multi_select)) {
    return prop.multi_select.map((s) => s?.name).filter(Boolean);
  }
  if (Array.isArray(prop.rich_text)) {
    const txt = prop.rich_text
      .map((r) => r?.plain_text ?? r?.text?.content ?? "")
      .join("")
      .trim();
    return txt ? [txt.slice(0, 80)] : [];
  }
  if (Array.isArray(prop.title)) {
    const txt = prop.title.map((r) => r?.plain_text ?? "").join("").trim();
    return txt ? [txt.slice(0, 80)] : [];
  }
  if (typeof prop.checkbox === "boolean") return [String(prop.checkbox)];
  if (typeof prop.number === "number") return [String(prop.number)];
  if (prop.date?.start) return [prop.date.start];
  if (prop.formula) {
    if (typeof prop.formula.string === "string" && prop.formula.string.trim())
      return [prop.formula.string.trim().slice(0, 80)];
    if (typeof prop.formula.number === "number") return [String(prop.formula.number)];
    if (typeof prop.formula.boolean === "boolean") return [String(prop.formula.boolean)];
  }
  return [];
}

function buildNotionExtrasPatterns(trades) {
  // Per-trade: collect every key::value pair present in notion_extras
  const tradeKVs = trades.map((t) => {
    const kvs = new Set();
    const ne = t.notion_extras;
    if (!ne || typeof ne !== "object" || Array.isArray(ne)) return kvs;
    for (const [k, v] of Object.entries(ne)) {
      if (SKIP_NE_KEYS.has(k)) continue;
      for (const val of extractNotionValues(v)) {
        if (val && val !== "false" && val.length < 100) {
          kvs.add(`${k}::${val}`);
        }
      }
    }
    return kvs;
  });

  // Only analyse key-value pairs that appear in at least 5 trades
  const kvCounts = new Map();
  for (const kvs of tradeKVs) {
    for (const kv of kvs) kvCounts.set(kv, (kvCounts.get(kv) ?? 0) + 1);
  }

  const qualified = new Set(
    [...kvCounts.entries()].filter(([, ct]) => ct >= 5).map(([kv]) => kv)
  );
  if (qualified.size === 0) return [];

  // Win rate with vs without each qualified kv pair
  const stats = new Map();
  for (const kv of qualified) {
    stats.set(kv, { withWins: 0, withDecided: 0, withoutWins: 0, withoutDecided: 0, count: kvCounts.get(kv) });
  }

  for (let i = 0; i < trades.length; i++) {
    const o = normOutcome(trades[i]);
    const w = isWin(o), l = isLoss(o);
    if (!w && !l) continue;
    for (const kv of qualified) {
      const s = stats.get(kv);
      if (tradeKVs[i].has(kv)) {
        if (w) s.withWins++;
        s.withDecided++;
      } else {
        if (w) s.withoutWins++;
        s.withoutDecided++;
      }
    }
  }

  const patterns = [];
  for (const [kv, s] of stats.entries()) {
    const wrWith = s.withDecided >= 5 ? round2(s.withWins / s.withDecided) : null;
    const wrWithout = s.withoutDecided >= 5 ? round2(s.withoutWins / s.withoutDecided) : null;
    if (wrWith === null || wrWithout === null) continue;
    const [key, value] = kv.split("::");
    patterns.push({
      key,
      value,
      count: s.count,
      winRateWith: wrWith,
      winRateWithout: wrWithout,
      diff: round2(wrWith - wrWithout),
    });
  }

  patterns.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return patterns.slice(0, 5);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runAnalysisEngine(userId) {
  if (!userId || typeof userId !== "string") {
    throw new Error("userId must be a non-empty string");
  }

  const trades = await fetchAllTradesForAnalysis(userId);

  if (trades.length === 0) {
    return {
      userId,
      generatedAt: new Date().toISOString(),
      tradeCount: 0,
      empty: true,
    };
  }

  // Supabase returns rows ordered ASC by date (from the query)
  const sorted = trades;

  return {
    userId,
    generatedAt: new Date().toISOString(),
    tradeCount: sorted.length,
    overview: buildOverview(sorted),
    bySession: buildBySession(sorted),
    byDay: buildByDay(sorted),
    bySessionDay: buildBySessionDay(sorted),
    byModel: buildByModel(sorted),
    byPair: buildByPair(sorted),
    byDirection: buildByDirection(sorted),
    streaksAndForm: buildStreaksAndForm(sorted),
    drawdown: buildDrawdown(sorted),
    edgeDetection: buildEdgeDetection(sorted),
    notionExtrasPatterns: buildNotionExtrasPatterns(sorted),
  };
}
