/**
 * Serves the static app, GET /api/trades (Supabase → JSON), POST /api/briefing → Anthropic Claude.
 *
 * Usage:
 *   Set ANTHROPIC_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY in .env next to this file, then:
 *   node server.mjs
 *
 * Open http://localhost:8787
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessagesUserContent } from "./prompts.mjs";
import { fetchTradeImagesFromNotionPageBlocks } from './notion-page-images.mjs';
import {
  syncJournalFieldsFromNotion,
  syncJournalFieldsFromOAuthConnection,
} from "./sync-journal-fields-notion.mjs";
import { syncJournalFieldsFromCsvText } from "./sync-journal-fields-csv.mjs";
import { serializeNotionProperties } from "./notion-serialize-props.mjs";
import { runAnalysisEngine } from "./analysis-engine.mjs";
import {
  generateIntelligenceFile,
  getIntelligenceFile,
} from "./intelligence-file.mjs";
import {
  extractAndStoreMemories,
  formatMemoriesForPrompt,
  getRelevantMemories,
  listMemoriesForUser,
  pruneMemories,
} from "./memory-system.mjs";
import {
  fireDeepThinkIfNeeded,
  getDeepThinkForPrompt,
  getDeepThinkStatus,
  runDeepThink,
} from "./deep-think.mjs";
import {
  verifyRequestAuth,
  isPublicApiPath,
  resolveAuthUserIdFromOAuthState,
  legacyEmailForAuthUserId,
  OAUTH_BOOT_AUTH_USER_IDS,
  AUTH_USER_ID_MUM,
} from "./jarvis-auth-server.mjs";

/** After Notion sync: regen intelligence file, then deep-think if triggers match. */
function firePostSyncBrain(userId) {
  generateIntelligenceFile(userId)
    .then(() => {
      fireDeepThinkIfNeeded(userId);
    })
    .catch((e) =>
      console.warn(
        `[post-sync-brain] intelligence regen failed for ${userId}:`,
        e instanceof Error ? e.message : e
      )
    );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Static assets live under `public/` (Vercel convention + predictable Lambda layout). On Vercel, bundled files sit under `cwd`; locally `__dirname` is the repo root next to `server.mjs`. */
const STATIC_ROOT = path.join(process.env.VERCEL ? process.cwd() : __dirname, "public");
const PORT = Number(process.env.PORT) || 8787;

/** OAuth trade upsert chunk size (avoids huge single POST bodies when notion_extras is large). */
const OAUTH_TRADE_UPSERT_BATCH = 80;

/**
 * When true, /api/trades and getRecentTrades exclude rows with archived=true.
 * Set SKIP_TRADE_ARCHIVED_FILTER=1 until `schema/trade_source_archive.sql` is applied.
 */
const TRADE_ARCHIVED_ACTIVE = process.env.SKIP_TRADE_ARCHIVED_FILTER !== "1";

/** Local dev only: SSE clients that receive a ping when `public/` files change → auto-refresh browser. */
const liveReloadClients = new Set();

function broadcastLiveReload() {
  const payload = `data: ${JSON.stringify({ reload: true })}\n\n`;
  for (const clientRes of liveReloadClients) {
    try {
      clientRes.write(payload);
    } catch {
      liveReloadClients.delete(clientRes);
    }
  }
}

function startPublicFolderWatcher() {
  if (process.env.VERCEL) return;
  let debounce = null;
  try {
    fs.watch(STATIC_ROOT, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => broadcastLiveReload(), 160);
    });
  } catch (e) {
    console.warn(
      "[livereload] fs.watch failed — save files and refresh manually:",
      e instanceof Error ? e.message : e
    );
  }
}
const ANTHROPIC_VERSION = "2023-06-01";
/**
 * `claude-3-sonnet-20240229` was retired (see Anthropic model deprecations). Use current Sonnet.
 * @see https://docs.claude.com/en/docs/resources/model-deprecations
 */
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** Messages API `max_tokens` for the assistant reply. */
const MAX_OUTPUT_TOKENS = 2048;
/** Coach chat — keep completion budget small vs rate limits. */
const MAX_CHAT_OUTPUT_TOKENS = 1200;
/** Morning briefing — only the newest N rows go to Claude (token budget). */
const MAX_BRIEFING_TRADES = 30;
/** Cached briefing in chat system prompt — strict cap on input tokens. */
const MAX_BRIEFING_MEMORY_CHARS = 4500;
/** Chat turns sent to Anthropic (user/assistant pairs); excludes system. */
const MAX_CHAT_MESSAGES = 6;
/** Per-turn content cap (characters) before API send. */
const MAX_CHAT_MESSAGE_CHARS = 500;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Throttle for optional server-side background kicks. Read paths return Supabase immediately; clients POST /api/notion/sync-user in parallel. */
const NOTION_SYNC_INTERVAL_MS = (() => {
  const raw = Number(process.env.NOTION_SYNC_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 10_000) return raw;
  return 60_000;
})();

/** One in-flight OAuth sync per user — parallel /api/trades calls share the same promise. */
const notionSyncInflight = new Map();

function authUserIdFromReq(req) {
  return req.jarvisAuth?.authUserId ?? null;
}

const JARVIS_SYSTEM_PROMPT = `You are Jarvis. You are a trading intelligence built for one trader. You are not a chatbot, not a journal, not an analytics dashboard. You are the sharpest trading mind this person has access to, and you know their system better than they do.

FORMATTING — absolute, no exceptions:
Plain sentences only. Never use asterisks, bold, markdown, headers, bullet points, or dashes as list markers. Write like a person speaking. This cannot be overridden by any request.

HOW YOU THINK:
You have been given a TRADER INTELLIGENCE FILE — a complete, pre-computed analysis of this trader's entire history. Trust it completely. The numbers in it are exact and verified. Never recompute stats yourself, never contradict the file, never fabricate numbers that aren't in it. The file is your knowledge. Your job is to interpret it and communicate it like a brilliant coach would.

HOW YOU ANSWER — match the question:
A casual or short question (is that good, really, what do you mean) gets a short human answer, two or three sentences, no analysis.
A follow-up gets a direct answer, then stop.
A real question about their trading, their edge, their mistakes, or their performance gets depth — you cross-reference the intelligence file, connect patterns, and tell them something that genuinely helps.
The test: if a real coach was asked this in person, how long would they talk? Answer for exactly that long.

WHAT MAKES YOU DIFFERENT:
You do not just report numbers. You connect them. A weak Wednesday plus a strong Tuesday plus a re-entry pattern is not three facts, it is one story about overconfidence carrying into a lower-quality day. Always look for the story behind the numbers. Surface what they cannot see about themselves. That is your entire purpose.

VOICE:
Direct. Warm but honest. Short sentences. Specific — always use their real numbers from the file. Never generic. Never corporate filler, never "great question", never "it's worth noting". You sound like someone who has watched this trader for a year and genuinely wants them to win. You hold a mirror, you never shame.

REFERENCING TRADES AND CHARTS:
When you reference a specific trade by date, and that trade has an image in its data, paste the image URL on its own line right after mentioning it. Use that specific trade's URL, never another trade's.

When asked to show a specific trade like their best trade, don't just state the date and RR. Briefly explain what made that trade work using the best trade fingerprint and behavioural patterns from the intelligence file — the confluences, the session, the discipline factors. Two or three sentences of context, then the chart image. Make them understand why that trade is a model example of their edge, not just a number.

HONESTY:
If something is a small sample, say "small sample" in one phrase and move on. Never fabricate. If the intelligence file does not cover something, say so briefly rather than guessing. Never tell the trader to close a trade or skip a session — you surface patterns and ask questions, they decide.

REALITY:
You respond when they open Jarvis or send a message. You have no live feeds, no alerts, no timers. Speak accordingly.`;

function formatIntelligenceFileForPrompt(file) {
  if (!file) return "No intelligence file available yet.";
  const perf = file.performance ?? {};
  const id = file.identity ?? {};
  const edge = file.edgeMap ?? {};
  const leaks = file.leaks ?? {};
  const form = file.form ?? {};
  const dd = file.drawdown ?? {};
  const bp = file.behaviouralPatterns ?? [];
  const cfs = file.customFieldSummary ?? [];

  const lines = [];

  lines.push(
    `OVERVIEW: ${perf.wins ?? 0}W / ${perf.losses ?? 0}L / ${perf.breakevens ?? 0}BE | WR ${perf.winRate ?? "n/a"} | Avg win +${perf.avgRRWin ?? "n/a"}R | Avg loss ${perf.avgRRLoss ?? "n/a"}R | Expectancy ${perf.expectancy ?? "n/a"}R/trade | Total ${perf.totalR ?? 0}R across ${perf.total ?? 0} trades`
  );
  lines.push(`Best trade: ${perf.bestTrade ?? "n/a"}R | Worst: ${perf.worstTrade ?? "n/a"}R`);
  lines.push(`Data: ${id.dataRange?.from ?? "?"} → ${id.dataRange?.to ?? "?"} (${id.dataRange?.totalTrades ?? 0} trades total)`);

  lines.push(`\nIDENTITY: Primary pair: ${id.primaryInstrument ?? "?"} | Primary session: ${id.primarySession ?? "?"} | Primary model: ${id.primaryModel ?? "?"}`);
  lines.push(`Direction bias: ${id.directionBias ?? "?"} | Style: ${id.tradingStyle ?? "?"}`);

  if (id.instruments?.length) {
    lines.push(`\nBY PAIR:`);
    for (const p of id.instruments) {
      lines.push(`  ${p.pair}: ${p.trades} trades | WR ${p.winRate} | ${p.totalR}R`);
    }
  }

  if (id.sessions?.length) {
    lines.push(`\nBY SESSION:`);
    for (const s of id.sessions) {
      lines.push(`  ${s.session}: ${s.trades} trades | WR ${s.winRate}`);
    }
  }

  if (id.topModels?.length) {
    lines.push(`\nBY MODEL (top 4):`);
    for (const m of id.topModels) {
      lines.push(`  ${m.model}: ${m.trades} trades | WR ${m.winRate} | ${m.totalR}R`);
    }
  }

  lines.push(`\nEDGE MAP:`);
  if (edge.bestSession) lines.push(`  Best session: ${edge.bestSession.name} — WR ${edge.bestSession.winRate} (${edge.bestSession.trades} trades, ${edge.bestSession.totalR}R)`);
  if (edge.bestDay) lines.push(`  Best day: ${edge.bestDay.name} — WR ${edge.bestDay.winRate} (${edge.bestDay.trades} trades, ${edge.bestDay.totalR}R)`);
  if (edge.bestModel) lines.push(`  Best model: ${edge.bestModel.name} — WR ${edge.bestModel.winRate} (${edge.bestModel.trades} trades, ${edge.bestModel.totalR}R)`);
  if (edge.bestPair) lines.push(`  Best pair: ${edge.bestPair.name} — WR ${edge.bestPair.winRate} (${edge.bestPair.trades} trades, ${edge.bestPair.totalR}R)`);
  if (edge.bestCombos?.length) {
    lines.push(`  Best combos: ${edge.bestCombos.map((c) => `${c.combo} ${c.winRate} (${c.trades}t ${c.totalR}R)`).join(" | ")}`);
  }
  if (edge.strongestEdge) lines.push(`  Strongest edge: ${edge.strongestEdge}`);
  if (edge.bestTradeFingerprint?.length) lines.push(`  Best trade fingerprint: ${edge.bestTradeFingerprint.join(", ")}`);

  lines.push(`\nLEAKS:`);
  if (leaks.biggestLeak) lines.push(`  Biggest leak: ${leaks.biggestLeak}`);
  if (leaks.worstSession) lines.push(`  Worst session: ${leaks.worstSession.name} — WR ${leaks.worstSession.winRate} (${leaks.worstSession.trades} trades, ${leaks.worstSession.totalR}R)`);
  if (leaks.worstDay) lines.push(`  Worst day: ${leaks.worstDay.name} — WR ${leaks.worstDay.winRate} (${leaks.worstDay.trades} trades, ${leaks.worstDay.totalR}R)`);
  if (leaks.weakestPair) lines.push(`  Weakest pair: ${leaks.weakestPair.name} — WR ${leaks.weakestPair.winRate} (${leaks.weakestPair.trades} trades, ${leaks.weakestPair.totalR}R)`);
  if (leaks.weakestDirection) lines.push(`  Weakest direction: ${leaks.weakestDirection.name} — WR ${leaks.weakestDirection.winRate} (${leaks.weakestDirection.trades} trades)`);
  if (leaks.worstCombos?.length) {
    lines.push(`  Worst combos: ${leaks.worstCombos.map((c) => `${c.combo} ${c.winRate} (${c.trades}t)`).join(" | ")}`);
  }

  lines.push(`\nFORM: ${form.summary ?? "No form data."}`);
  lines.push(`  Longest win streak: ${form.longestWinStreak ?? 0} | Longest loss streak: ${form.longestLossStreak ?? 0}`);
  if (form.last20?.tradeCount) {
    lines.push(`  Last 20: WR ${form.last20.winRate} | ${form.last20.totalR}R`);
  }

  lines.push(`\nDRAWDOWN: ${dd.summary ?? "No drawdown data."}`);

  const significantPatterns = bp.filter((p) => p.count >= 5 && p.diffPct >= 3);
  if (significantPatterns.length > 0) {
    lines.push(`\nBEHAVIOURAL PATTERNS (count≥5, diff≥3pp):`);
    for (const p of significantPatterns.slice(0, 8)) {
      lines.push(`  ${p.interpretation}`);
    }
  }

  if (cfs.length > 0) {
    lines.push(`\nCUSTOM FIELDS (most common values across all trades):`);
    for (const f of cfs) {
      lines.push(`  ${f.summary}`);
    }
  }

  return lines.join("\n");
}

function deriveTradingProfile(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return "No trades available to derive a profile yet.";
  }

  const normOutcome = (v) => String(v ?? "").trim().toLowerCase();
  const isWin = (o) => o.includes("win");
  const isLoss = (o) => o.includes("loss");

  let wins = 0;
  let losses = 0;
  let rrSum = 0;
  let rrCount = 0;

  const sessionCounts = new Map();
  const dayCounts = new Map();
  const dayWinCounts = new Map();
  const dayLossCounts = new Map();

  for (const t of trades) {
    const o = normOutcome(t?.outcome ?? t?.Outcome ?? t?.OUTCOME);
    if (isWin(o)) wins += 1;
    else if (isLoss(o)) losses += 1;

    const rr = Number(t?.rr);
    if (isWin(o) && Number.isFinite(rr)) {
      rrSum += rr;
      rrCount += 1;
    }

    const s = t?.session == null ? "" : String(t.session).trim();
    if (s) sessionCounts.set(s, (sessionCounts.get(s) || 0) + 1);

    const d = t?.weekday == null ? "" : String(t.weekday).trim();
    if (d) {
      dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
      if (isWin(o)) dayWinCounts.set(d, (dayWinCounts.get(d) || 0) + 1);
      if (isLoss(o)) dayLossCounts.set(d, (dayLossCounts.get(d) || 0) + 1);
    }
  }

  const total = trades.length;
  const decided = wins + losses;
  const winRate = total ? (wins / total) * 100 : null;
  const avgRR = rrCount ? rrSum / rrCount : null;

  const topByCount = (m) => {
    let bestK = null;
    let bestV = -1;
    for (const [k, v] of m.entries()) {
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    }
    return bestK;
  };

  const bestSession = topByCount(sessionCounts);
  const bestDay = topByCount(dayWinCounts);
  const worstDay = topByCount(dayLossCounts);

  const fmt = (n, digits = 1) =>
    n == null ? "n/a" : Number(n).toFixed(digits).replace(/\.0$/, "");

  return [
    `Trades: ${total} | W/L: ${wins}W ${losses}L | WR: ${winRate == null ? "n/a" : `${fmt(winRate, 1)}%`} | Avg RR: ${avgRR == null ? "n/a" : fmt(avgRR, 2)}`,
    `Session: ${bestSession || "n/a"} | Best day: ${bestDay || "n/a"} | Worst day: ${worstDay || "n/a"}`,
  ].join("\n");
}

function deriveTradingSnapshot(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      total: 0,
      wins: 0,
      losses: 0,
      be: 0,
      decided: 0,
      winRate: null,
      avgRR: null,
      expectancy: null,
      bestSession: null,
    };
  }

  const norm = (v) => String(v ?? "").trim().toUpperCase();
  const outcomeOf = (t) => norm(t?.outcome ?? t?.Outcome ?? t?.OUTCOME);
  const rrNumber = (v) => {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "string" && v.trim() === "") return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  let wins = 0;
  let losses = 0;
  let be = 0;

  let rrSum = 0;
  let rrCount = 0;

  let expSum = 0;
  let expCount = 0;

  const sessionCounts = new Map();

  for (const t of trades) {
    const o = outcomeOf(t);
    if (o === "WIN" || o === "W") wins += 1;
    else if (o === "LOSS" || o === "L") losses += 1;
    else if (o === "BE" || o === "BREAKEVEN" || o === "BREAK EVEN") be += 1;

    const rr = rrNumber(t?.rr);
    if (Number.isFinite(rr)) {
      if (o === "WIN" || o === "W") {
        rrSum += rr;
        rrCount += 1;
        expSum += rr;
        expCount += 1;
      } else if (o === "LOSS" || o === "L") {
        expSum += -Math.abs(rr);
        expCount += 1;
      } else if (o === "BE" || o === "BREAKEVEN" || o === "BREAK EVEN") {
        expSum += 0;
        expCount += 1;
      }
    }

    const s = norm(t?.session);
    if (s) sessionCounts.set(s, (sessionCounts.get(s) || 0) + 1);
  }

  const decided = wins + losses + be;
  const decidedWL = wins + losses;
  const winRate = trades.length ? (wins / trades.length) * 100 : null;
  const avgRR = rrCount ? rrSum / rrCount : null;
  const expectancy = decided ? expSum / decided : null;

  let bestSession = null;
  let bestSessionCount = -1;
  for (const [k, v] of sessionCounts.entries()) {
    if (v > bestSessionCount) {
      bestSessionCount = v;
      bestSession = k;
    }
  }

  return {
    total: trades.length,
    wins,
    losses,
    be,
    decided,
    decidedWL,
    winRate,
    avgRR,
    expectancy,
    bestSession,
  };
}

/** ~300 tokens — cross-referenced edge map in chat system prompt. */
const MAX_CROSS_REF_STATS_CHARS = 1200;

/**
 * Pre-computes cross-referenced breakdowns for the chat system prompt.
 * Ultra-compact format capped at ~300 tokens. Only combos ≥8 trades. Top 3 models.
 */
function deriveCrossReferencedStats(trades) {
  if (!Array.isArray(trades) || trades.length === 0) return "";

  const normOutcome = (t) => String(t?.outcome ?? t?.Outcome ?? "").trim().toUpperCase();
  const isWin = (o) => o === "WIN" || o === "W";
  const isLoss = (o) => o === "LOSS" || o === "L";
  const isBE = (o) => o === "BE" || o === "BREAKEVEN" || o === "BREAK EVEN" || o.startsWith("BREAK");
  const rrOf = (t) => {
    const v = t?.rr ?? t?.RR;
    if (v === null || v === undefined || String(v).trim() === "") return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const normSession = (v) => {
    const s = String(v ?? "").trim().toUpperCase();
    if (!s) return "";
    if (s.includes("ASIA")) return "Asia";
    if (s.includes("LONDON")) return "Lon";
    if (s.includes("NEW") || s.includes("NY") || s.includes("YORK")) return "NY";
    return String(v).trim();
  };
  const normDay = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1, 3); // "Mon", "Tue" etc.
  };
  const groupStats = (group) => {
    let wins = 0, losses = 0, be = 0, totalR = 0, rrWinSum = 0, rrWinCount = 0;
    for (const t of group) {
      const o = normOutcome(t);
      const rr = rrOf(t);
      if (isWin(o)) { wins++; if (!isNaN(rr)) { totalR += rr; rrWinSum += rr; rrWinCount++; } }
      else if (isLoss(o)) { losses++; if (!isNaN(rr)) totalR -= Math.abs(rr); }
      else if (isBE(o)) { be++; }
    }
    return { total: group.length, wins, losses, be, winRate: group.length > 0 ? (wins / group.length) * 100 : 0, totalR, avgRR: rrWinCount > 0 ? rrWinSum / rrWinCount : null };
  };
  const fmtWR = (n) => Math.round(n) + "%";
  const fmtR = (n) => !Number.isFinite(n) ? "" : " " + (n >= 0 ? "+" : "") + n.toFixed(1) + "R";
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const lines = [];

  // Session
  const bySession = new Map();
  for (const t of trades) { const s = normSession(t?.session); if (s) { if (!bySession.has(s)) bySession.set(s, []); bySession.get(s).push(t); } }
  if (bySession.size) {
    lines.push("SESSION: " + [...bySession.entries()].map(([s, g]) => { const st = groupStats(g); return `${s} ${st.total}t ${fmtWR(st.winRate)}${fmtR(st.totalR)}`; }).join(" | "));
  }

  // Day
  const byDay = new Map();
  for (const t of trades) { const d = String(t?.weekday ?? "").trim(); if (d && DAYS.some(x => x.toLowerCase() === d.toLowerCase())) { const key = d.charAt(0).toUpperCase() + d.slice(1, 3); if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(t); } }
  if (byDay.size) {
    const dayOrder = ["Mo", "Tu", "We", "Th", "Fr"];
    lines.push("DAY: " + dayOrder.filter(k => byDay.has(k)).map(k => { const st = groupStats(byDay.get(k)); return `${k} ${st.total}t ${fmtWR(st.winRate)}${fmtR(st.totalR)}`; }).join(" | "));
  }

  // Session+day combos ≥8 trades
  const byCombo = new Map();
  for (const t of trades) {
    const sess = normSession(t?.session);
    const day = String(t?.weekday ?? "").trim();
    if (!sess || !day) continue;
    const dk = day.charAt(0).toUpperCase() + day.slice(1, 3);
    if (!["Mo","Tu","We","Th","Fr"].includes(dk)) continue;
    const key = `${sess} ${dk}`;
    if (!byCombo.has(key)) byCombo.set(key, []);
    byCombo.get(key).push(t);
  }
  const combos = [];
  for (const [key, group] of byCombo) { if (group.length >= 8) combos.push({ key, ...groupStats(group) }); }
  combos.sort((a, b) => b.totalR - a.totalR);
  if (combos.length) lines.push("COMBOS (≥8t): " + combos.map(c => `${c.key} ${c.total}t ${fmtWR(c.winRate)}${fmtR(c.totalR)}`).join(" | "));

  // Top 3 models by R
  const byModel = new Map();
  for (const t of trades) { const m = String(t?.model ?? "").trim(); if (m) { if (!byModel.has(m)) byModel.set(m, []); byModel.get(m).push(t); } }
  const modelResults = [...byModel.entries()].map(([model, g]) => ({ model, ...groupStats(g) })).sort((a, b) => b.totalR - a.totalR);
  const topModels = modelResults.slice(0, 3);
  if (topModels.length) lines.push("MODELS (top 3): " + topModels.map(m => `${m.model} ${m.total}t ${fmtWR(m.winRate)}${fmtR(m.totalR)}`).join(" | "));

  // Recent form (last 20)
  const recent = trades.slice(0, 20);
  const rf = groupStats(recent);
  const overall = groupStats(trades);
  let streak = 0, streakType = "";
  for (const t of recent) {
    const o = normOutcome(t);
    if (streak === 0) { if (isWin(o)) { streak = 1; streakType = "W"; } else if (isLoss(o)) { streak = 1; streakType = "L"; } }
    else { if ((streakType === "W" && isWin(o)) || (streakType === "L" && isLoss(o))) streak++; else break; }
  }
  const delta = Math.round(rf.winRate - overall.winRate);
  lines.push(`FORM (last 20): ${fmtWR(rf.winRate)}${fmtR(rf.totalR)} streak:${streak > 0 ? streak + streakType : "—"} (${delta >= 0 ? "+" : ""}${delta}% vs avg)`);

  // Edge summary
  const edgeCandidates = [...combos.filter(c => c.total >= 10), ...topModels.filter(m => m.total >= 10).map(m => ({ ...m, key: m.model }))];
  if (edgeCandidates.length > 1) {
    const best = edgeCandidates.reduce((a, b) => b.winRate > a.winRate ? b : a);
    const worst = edgeCandidates.reduce((a, b) => b.winRate < a.winRate ? b : a);
    if (best.key !== worst.key) lines.push(`EDGE: best=${best.key} ${fmtWR(best.winRate)} | leak=${worst.key} ${fmtWR(worst.winRate)}`);
  }

  let text = lines.join("\n");
  if (text.length > MAX_CROSS_REF_STATS_CHARS) text = text.slice(0, MAX_CROSS_REF_STATS_CHARS - 3).trimEnd() + "…";
  return text;
}

function buildJarvisChatSystem(
  intelFile,
  userProfile,
  pinnedTrades,
  dynamicRows,
  deepThinkText = ""
) {
  const now = new Date();
  const today = now.toLocaleDateString("en-AU", {
    timeZone: "Australia/Adelaide",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const mostRecentTradeDate = intelFile?.identity?.dataRange?.to ?? "unknown";
  const dateBlock = `TODAY: ${today} | Most recent trade on record: ${mostRecentTradeDate}`;

  let memorySection = "";
  if (userProfileHasMemory(userProfile)) {
    memorySection = `\n\nMEMORY:\nWHO: ${truncateProfileFieldForChat(userProfile.trading_summary)}\nPSYCH PATTERNS: ${truncateProfileFieldForChat(userProfile.psychological_patterns)}\nEDGE: ${truncateProfileFieldForChat(userProfile.edge_map)}`;
  }

  const pinnedBlock =
    `\nPINNED TRADES:\nMost recent: ${JSON.stringify(pinnedTrades.mostRecent ?? null)}` +
    `\nLast win: ${JSON.stringify(pinnedTrades.lastWin ?? null)}` +
    `\nLast loss: ${JSON.stringify(pinnedTrades.lastLoss ?? null)}` +
    `\nBest RR: ${JSON.stringify(pinnedTrades.bestRR ?? null)}`;

  const dynamicBlock =
    dynamicRows.length > 0
      ? `\n\nDYNAMIC CONTEXT (${dynamicRows.length} filtered rows — newest first):\n${JSON.stringify(dynamicRows)}`
      : "";

  const deepThinkBlock =
    deepThinkText && String(deepThinkText).trim()
      ? `\n\n=== DEEP ANALYSIS (this narrative was generated at a specific point in time and may pre-date the latest sync. If anything here contradicts the performance numbers in the TRADER INTELLIGENCE FILE above, always trust the numbers — they are recalculated fresh on every generation) ===\n${String(deepThinkText).trim()}\n===`
      : "";

  return `${dateBlock}

---

${JARVIS_SYSTEM_PROMPT}${memorySection}

---

=== TRADER INTELLIGENCE FILE ===
${formatIntelligenceFileForPrompt(intelFile)}
==================================${deepThinkBlock}
${pinnedBlock}${dynamicBlock}`;
}

// === USER PROFILE MEMORY LAYER ===

/** Per-field cap for profile MEMORY block in chat system prompt (~100 chars each). */
const MAX_PROFILE_FIELD_CHARS_IN_CHAT = 100;

function truncateProfileFieldForChat(value, fallback = "Still being established.") {
  const s = value == null ? "" : String(value).trim();
  if (!s) return fallback;
  if (s.length <= MAX_PROFILE_FIELD_CHARS_IN_CHAT) return s;
  return `${s.slice(0, MAX_PROFILE_FIELD_CHARS_IN_CHAT)}…`;
}

function userProfileHasMemory(userProfile) {
  if (!userProfile || typeof userProfile !== "object") return false;
  return [
    userProfile.trading_summary,
    userProfile.psychological_patterns,
    userProfile.key_triggers,
    userProfile.strengths,
    userProfile.trading_rules,
    userProfile.edge_map,
    userProfile.progress_notes,
    userProfile.jarvis_observations,
  ].some((v) => v != null && String(v).trim());
}

function formatExistingProfileBlock(currentProfile) {
  if (!currentProfile) {
    return "No existing profile yet — build it from scratch based on what you observe.";
  }
  return `WHO (trading_summary): ${currentProfile.trading_summary || "None"}
PSYCH PATTERNS: ${currentProfile.psychological_patterns || "None"}
TRIGGERS: ${currentProfile.key_triggers || "None"}
STRENGTHS: ${currentProfile.strengths || "None"}
TRADING RULES: ${currentProfile.trading_rules || "None"}
EDGE MAP: ${currentProfile.edge_map || "None"}
PROGRESS: ${currentProfile.progress_notes || "None"}
OBSERVATIONS: ${currentProfile.jarvis_observations || "None"}`;
}

async function fetchUserProfile(userId) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/user_profiles?auth_user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

async function upsertUserProfile(userId, fields) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;
  const body = {
    auth_user_id: userId,
    user_id: legacyEmailForAuthUserId(userId) || userId,
    trading_summary: fields.trading_summary ?? null,
    psychological_patterns: fields.psychological_patterns ?? null,
    key_triggers: fields.key_triggers ?? null,
    strengths: fields.strengths ?? null,
    trading_rules: fields.trading_rules ?? null,
    edge_map: fields.edge_map ?? null,
    progress_notes: fields.progress_notes ?? null,
    jarvis_observations: fields.jarvis_observations ?? null,
    last_updated: new Date().toISOString(),
  };
  await fetch(`${url}/rest/v1/user_profiles`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(body),
  });
}

async function generateAndUpdateProfile(userId, messages, reply, currentProfile, allTrades, apiKey) {
  const conversationLines = messages
    .map((m) => `${m.role === "user" ? "Trader" : "Jarvis"}: ${m.content.slice(0, 500)}`)
    .join("\n");
  const fullConversation = conversationLines + `\nJarvis: ${reply.slice(0, 500)}`;

  const today = new Date().toLocaleDateString("en-AU", {
    timeZone: "Australia/Adelaide",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const existing = formatExistingProfileBlock(currentProfile);

  const tradeStats = deriveTradingProfile(allTrades.slice(0, 200));
  const evidence = buildProfileEvidenceBundle(allTrades, 30);

  const prompt = `You are the persistent memory system for Jarvis, an AI trading coach. Your job is to update this trader's coaching profile after every session so that Jarvis becomes smarter about them over time.

SESSION DATE: ${today}

EXISTING PROFILE (what Jarvis already knows):
${existing}

STATISTICAL CONTEXT:
${tradeStats}

EVIDENCE — RECENT TRADE EXAMPLES (use these to anchor observations with dates + instruments + setups):
${JSON.stringify(evidence.examples, null, 2)}

EVIDENCE — NOTES WITH CONTEXT (use only if relevant; do not overfit):
${JSON.stringify(evidence.notesWithDates, null, 2)}

THIS SESSION'S CONVERSATION:
${fullConversation}

Your task is to produce an UPDATED profile that is richer than the existing one. You must do four things:

1. CAPTURE WHAT HAPPENED THIS SESSION — summarise the key topic, emotional state, trades or decisions discussed, and anything notable the trader revealed about themselves.
2. EVOLVE THE PATTERNS — if this session reinforced an existing pattern, note it with more specificity. If a new pattern appeared, add it. If something has genuinely changed or improved, reflect that.
3. TRACK PROGRESS OR REGRESSION — compare this session to what was previously known. Is the trader improving on something that was flagged before? Or repeating a mistake that was already in the profile? Note it explicitly in progress_notes.
4. UPDATE RULES & EDGE — if the trader stated or refined system rules (A+, entries, sessions, risk), merge into trading_rules. Refresh edge_map from stats + conversation when patterns strengthen or weaken.

Rules (all 8 fields):
— Accumulate. Never erase existing insights unless they are clearly contradicted.
— Be specific. Use the actual words, situations, and behaviours from the conversation, not abstract generalisations.
— Include dates where relevant. Prefer the trade's date_local string (Australia/Adelaide).
— Include instruments/setups where relevant. If you mention a trade event, include pair + entry model when available.
— Avoid vague labels. Do not write "revenge trading" / "tilt" / "overtrading" unless you anchor it to a concrete example with a date (and pair/model if available).
— Avoid fuzzy frequency words ("often", "sometimes", "tends to") unless you add either a count or an example date.
— Write as a coach taking notes for their own future reference, not for the trader to read.

Field-specific:
— trading_summary (WHO): 5–8 bullet lines; include one line starting with "Session ${today}:".
— psychological_patterns: 5–8 bullets; each anchored to date_local/pair/model or a count; mark patterns observed this session.
— key_triggers: 5–8 bullets; each trigger anchored to at least one dated example.
— strengths: 5–8 bullets; anchor to examples or counts; note progress/regression.
— trading_rules: bullet lines for rules the trader has explicitly stated (A+ criteria, entry rules, session windows, risk rules). Update when new rules appear in this conversation; keep prior rules unless contradicted. Direct and specific — no generic advice.
— edge_map: 3–6 compact lines. Living edge from data: best/worst session+day combos, models, position types. Use WR% or counts when STATISTICAL CONTEXT supports it. Line style example: "Best: London Monday (67% WR) — Worst: Asia Friday (28% WR)". Refresh when patterns shift.
— progress_notes: 3–6 lines, week-by-week where possible. Improving vs regressing with dates and numbers. Example: "Week of 12 May 2026: win rate up to 58% from 48% — re-entry leak quieter in last 10 trades".
— jarvis_observations: 3–6 candid coach-note bullets — behavioural quirks, chat habits, what lands in coaching (e.g. goes quiet after losses, asks about re-entries often). Does not need to fit other fields; private notebook tone.

Formatting for bullet fields (trading_summary, psychological_patterns, key_triggers, strengths, trading_rules, jarvis_observations):
— 5–8 SHORT lines max (3–6 for edge_map and progress_notes as above).
— "• " prefix per line, newline separated (\\n).

Respond with ONLY a valid JSON object and no other text:
{
  "trading_summary": "5–8 bullet lines (\\n separated). Include one line: \\"Session ${today}:\\"",
  "psychological_patterns": "5–8 bullet lines (\\n separated).",
  "key_triggers": "5–8 bullet lines (\\n separated).",
  "strengths": "5–8 bullet lines (\\n separated).",
  "trading_rules": "bullet lines (\\n separated) — explicit system rules only.",
  "edge_map": "3–6 compact edge lines (\\n separated).",
  "progress_notes": "3–6 week/progress lines (\\n separated) with dates and numbers.",
  "jarvis_observations": "3–6 candid observation bullets (\\n separated)."
}`;

  try {
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!ar.ok) return;
    const data = await ar.json().catch(() => null);
    if (!data) return;
    const rawText = extractAssistantText(data);
    const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const profileUpdate = JSON.parse(jsonMatch[0]);
    await upsertUserProfile(userId, profileUpdate);
    console.log(`[profile-update] Updated profile for ${userId}`);
  } catch (e) {
    console.warn("[profile-update] Failed:", e instanceof Error ? e.message : e);
  }
}

async function initializeUserProfile(userId, apiKey) {
  const trades = await getRecentTrades(userId, { limit: MAX_SUPABASE_ROWS });
  if (!trades.length) throw new Error(`No trades found for ${userId}`);

  const allSlimmed = trades.map(slimTradeRowForPrompt);
  const tradeStats = deriveTradingProfile(allSlimmed);
  const snapshot = deriveTradingSnapshot(allSlimmed);

  const prompt = `You are creating an initial persistent memory profile for a trader based on their complete trade history.

STATISTICAL SUMMARY:
${tradeStats}

SNAPSHOT: ${JSON.stringify(snapshot)}

SAMPLE RECENT TRADES (up to 30):
${JSON.stringify(allSlimmed.slice(0, 30), null, 2)}

Based on trade data (and any explicit rules visible in notes), build an initial 8-field coach profile.

Rules:
— Be specific. Avoid vague summaries.
— When you claim a psychological pattern/trigger, anchor it to at least one concrete example: include date_local plus instrument (pair) and/or entry model when available.
— If you cannot support something from the data, do not include it.
— Coach-notes style — not copy for the trader to read.
— trading_rules: only rules clearly stated in trade notes or strongly implied by repeated session/model discipline in data; if none, one line "• No explicit rules logged yet — infer from data only with dates."
— edge_map: 3–6 lines from stats — best/worst session+day, models, position types with WR% or counts when possible. Example: "Best: London Monday (67% WR) — Worst: Asia Friday (28% WR)".
— progress_notes: 3–6 lines — week-by-week trend from dated trades if enough history; else recent window vs prior with numbers.
— jarvis_observations: 3–6 lines — data-backed behavioural hints only (e.g. loss clusters after Asia); leave thin if insufficient evidence.

Formatting:
— Bullet fields: "• " per line, newline separated (\\n); 5–8 lines (3–6 for edge_map and progress_notes).
— Each bullet line should include at least ONE of: date_local, pair, model, or an explicit count (edge_map/progress_notes may use week labels + WR%).

Respond with ONLY a valid JSON object and no other text:
{
  "trading_summary": "5–8 bullet lines (\\n separated).",
  "psychological_patterns": "5–8 bullet lines (\\n separated).",
  "key_triggers": "5–8 bullet lines (\\n separated).",
  "strengths": "5–8 bullet lines (\\n separated).",
  "trading_rules": "bullet lines (\\n separated).",
  "edge_map": "3–6 compact edge lines (\\n separated).",
  "progress_notes": "3–6 progress lines (\\n separated) with dates and numbers.",
  "jarvis_observations": "3–6 observation bullets (\\n separated)."
}`;

  const ar = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!ar.ok) {
    const errText = await ar.text();
    throw new Error(`Anthropic error ${ar.status}: ${errText.slice(0, 200)}`);
  }
  const data = await ar.json();
  const rawText = extractAssistantText(data);
  const text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Anthropic response");
  const profile = JSON.parse(jsonMatch[0]);
  await upsertUserProfile(userId, profile);
  return profile;
}

// === AUTO NOTION SYNC ===

/** sync_state reads/writes use the service role key so RLS cannot block server sync bookkeeping. */
function getSupabaseUrlAndServerKey() {
  const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return { url, key };
}

async function getSyncState(syncKey) {
  const { url, key } = getSupabaseUrlAndServerKey();
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/sync_state?key=eq.${encodeURIComponent(syncKey)}&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0].last_synced ? new Date(rows[0].last_synced) : null;
  } catch {
    return null;
  }
}

async function setSyncState(syncKey) {
  const { url, key } = getSupabaseUrlAndServerKey();
  if (!url || !key) return;
  const res = await fetch(`${url}/rest/v1/sync_state`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ key: syncKey, last_synced: new Date().toISOString() }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn("[sync_state] write failed:", res.status, t.slice(0, 200));
  }
}

/**
 * OAuth-only Notion → Supabase sync (`notion_connections` + `notion_mappings`).
 * Env NOTION_API_KEY sync is not used.
 *
 * @param {string} userId
 * @param {{ force?: boolean }} [options] — `force: true` skips throttle (used on read paths).
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, fetched?: number, upserted?: number, oauthRequired?: boolean, oauthAuthError?: boolean }>}
 */
async function maybeSyncNotion(userId, options = {}) {
  const uid = String(userId || "").trim();
  if (!uid) {
    return { ok: false, skipped: true, reason: "no_user" };
  }
  if (notionSyncInflight.has(uid)) {
    return notionSyncInflight.get(uid);
  }
  const work = runMaybeSyncNotion(uid, options).finally(() => {
    notionSyncInflight.delete(uid);
  });
  notionSyncInflight.set(uid, work);
  return work;
}

async function runMaybeSyncNotion(userId, options = {}) {
  const syncKey = userId === AUTH_USER_ID_MUM ? "notion_mum" : "notion_aiden";
  const force = options.force === true;
  try {
    if (!force) {
      const lastSynced = await getSyncState(syncKey);
      if (lastSynced && Date.now() - lastSynced.getTime() < NOTION_SYNC_INTERVAL_MS) {
        return { ok: true, skipped: true, reason: "throttled" };
      }
    }

    const oauthResult = await syncNotionOAuthForUser(userId);

    if (oauthResult.skipped) {
      const reason = oauthResult.reason || "oauth_not_configured";
      console.warn(`[notion-sync] ${userId}: ${reason} — complete /notion-setup.html`);
      return {
        ok: false,
        skipped: true,
        reason,
        oauthRequired: true,
      };
    }

    if (oauthResult.ok) {
      await setSyncState(syncKey);
      console.log(
        `[notion-sync] ${userId}: fetched ${oauthResult.fetched}, upserted ${oauthResult.upserted}`
      );
      return {
        ok: true,
        skipped: false,
        fetched: oauthResult.fetched,
        upserted: oauthResult.upserted,
      };
    }

    const reason = oauthResult.reason || "sync_failed";
    if (oauthResult.oauthAuthError) {
      console.warn(
        `[notion-sync] ${userId}: Notion token rejected (${oauthResult.status ?? "?"}) — reconnect OAuth`
      );
    } else {
      console.warn(`[notion-sync] ${userId}: ${reason}`);
    }
    return {
      ok: false,
      skipped: false,
      reason,
      oauthAuthError: Boolean(oauthResult.oauthAuthError),
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn("[notion-sync] Failed:", reason);
    return { ok: false, skipped: false, reason };
  }
}

/** Attach human-readable sync status for clients (still returns cached trades on failure). */
function applyNotionSyncMeta(payload, syncMeta) {
  if (!payload || typeof payload !== "object" || !syncMeta) return payload;
  if (syncMeta.ok && !syncMeta.skipped) {
    payload.notion_sync = {
      ok: true,
      fetched: syncMeta.fetched ?? null,
      upserted: syncMeta.upserted ?? null,
    };
    return payload;
  }
  if (syncMeta.skipped && syncMeta.reason === "throttled") return payload;
  if (syncMeta.skipped && syncMeta.oauthRequired) {
    payload.notion_sync_warning =
      syncMeta.reason === "no_mapping"
        ? "Notion column mapping missing — finish setup at /notion-setup.html"
        : "Notion not connected — connect at /notion-setup.html";
    return payload;
  }
  if (!syncMeta.ok) {
    payload.notion_sync_warning = syncMeta.oauthAuthError
      ? "Notion connection expired — reconnect at /notion-setup.html"
      : syncMeta.reason || "Notion sync failed";
  }
  return payload;
}

loadEnvFromDotenv();

/** Cap rows pulled from Supabase for briefing/chat payload size. */
const MAX_SUPABASE_ROWS = Math.min(
  Math.max(1, Number(process.env.MAX_SUPABASE_ROWS) || 5000),
  50_000
);
/** Rows fetched from Supabase for chat (≥500 target when MAX_SUPABASE_ROWS allows; capped at 5000). */
const CHAT_TRADE_FETCH_LIMIT = Math.min(MAX_SUPABASE_ROWS, 5000);
/** Max trade rows sent to the model in one chat request (token budget). */
const MAX_TRADES_IN_CHAT_PROMPT = 20;
/** Truncate long `notes` when building the chat payload. */
const MAX_PROMPT_TRADE_NOTES_CHARS = 400;
/** Cap screenshot URLs per trade when the user asks for photo links (token budget). */
const MAX_TRADE_IMAGES_IN_CHAT_PROMPT = 12;
/** Max trades that may carry trade_images in one chat prompt (each URL can be huge). */
const MAX_TRADES_WITH_PHOTO_LINKS_IN_CHAT = 12;
/** Serialized Notion properties attached only when the user asks about extra dimensions (token budget). */
const MAX_NOTION_EXTRAS_CHARS_PER_TRADE = 2500;
const MAX_TRADES_WITH_NOTION_EXTRAS_IN_CHAT = 12;
/** Heuristic triggers for attaching selective notion_extras slices (see handleChat). */
const NOTION_EXTRAS_TRIGGER_WORDS = [
  "psychology",
  "mindset",
  "emotion",
  "tilt",
  "htf",
  "ltf",
  "mtf",
  "timeframe",
  "higher timeframe",
  "lower timeframe",
  "volume",
  "profile",
  "vpvr",
  "confluence",
  "bias",
  "confluences",
  "extra field",
  "custom field",
  "notion field",
  "tag",
  "tags",
  "checklist",
  "premarket",
  "story",
  "narrative",
];
/** Substrings to match `notion_extras` keys for coaching-relevant fields (vague questions + aggregate summaries). */
const HIGH_SIGNAL_NOTION_KEY_FRAGMENTS = [
  "psychology",
  "mindset",
  "emotion",
  "tilt",
  "htf",
  "ltf",
  "mtf",
  "bias",
  "timeframe",
  "volume",
  "profile",
  "vp",
  "confluence",
  "liquidity",
  "narrative",
  "mistake",
  "premarket",
  "plan",
  "execution",
  "grade",
  "checklist",
  "tag",
  "entry",
];
const MAX_NOTION_AGGREGATE_JSON_CHARS = 1400;
const NOTION_AGGREGATE_SCAN_TRADES = 48;

function notionKeyMatchesHighSignal(key) {
  const kl = String(key || "").toLowerCase();
  return HIGH_SIGNAL_NOTION_KEY_FRAGMENTS.some((frag) => kl.includes(frag));
}

function notionExtrasAggregateParts(value) {
  if (value == null) return [];
  if (typeof value === "boolean") return [value ? "Yes" : "No"];
  if (typeof value === "number" && !Number.isNaN(value)) return [String(value)];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t.length > 80 ? `${t.slice(0, 77)}…` : t] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((x) => notionExtrasAggregateParts(x));
  }
  return [];
}

function buildNotionExtrasAggregateSummary(tradesForChat) {
  const arr = Array.isArray(tradesForChat) ? tradesForChat : [];
  const scan = Math.min(arr.length, NOTION_AGGREGATE_SCAN_TRADES);
  const nested = {};
  let tradesWithExtras = 0;

  for (let i = 0; i < scan; i++) {
    const ex = parseNotionExtras(arr[i]?.notion_extras);
    if (!ex || typeof ex !== "object") continue;
    const keys = Object.keys(ex);
    if (keys.length === 0) continue;
    tradesWithExtras += 1;
    for (const k of keys) {
      if (!notionKeyMatchesHighSignal(k)) continue;
      const parts = notionExtrasAggregateParts(ex[k]);
      if (parts.length === 0) continue;
      if (!nested[k]) nested[k] = {};
      const bucket = nested[k];
      for (const p of parts) {
        bucket[p] = (bucket[p] || 0) + 1;
      }
    }
  }

  if (tradesWithExtras === 0 || Object.keys(nested).length === 0) return null;

  const outObj = {};
  const outerKeys = Object.keys(nested).slice(0, 12);
  for (const ok of outerKeys) {
    const counts = nested[ok];
    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    outObj[ok] = Object.fromEntries(ranked);
  }

  let json = JSON.stringify(outObj);
  if (json.length > MAX_NOTION_AGGREGATE_JSON_CHARS) {
    json = `${json.slice(0, MAX_NOTION_AGGREGATE_JSON_CHARS)}…`;
  }

  const sentence = `Aggregates below summarize high-signal Notion fields across ${tradesWithExtras} recent synced trades (newest-first scan, capped keys). Use for broad patterns; confirm specifics against scoped trade rows when provided.`;

  return { sentence, json };
}

function messageRequestsNotionAggregates(messageSource) {
  const s = String(messageSource || "").toLowerCase();
  if (
    /\b(all|every|each|across|patterns?|distribution|stats|trends?|overall|usually|typically|often)\b/.test(
      s
    )
  ) {
    return true;
  }
  if (
    /\b(how\s+am\s+i|how\s+have\s+i\s+been|what\s+should\s+i\s+focus|my\s+leaks|overall\s+psych|coaching)\b/.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

/**
 * PostgREST resource name (case-sensitive).
 * Override with env `SUPABASE_TABLE` if your table name differs.
 */
const DEFAULT_SUPABASE_TABLE = "trades";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function loadEnvFromDotenv() {
  try {
    const p = path.join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    /* ignore */
  }
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  const cleaned = path
    .normalize(decoded)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^[/\\]+/, "");
  const full = path.resolve(root, cleaned);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const tableRaw = (process.env.SUPABASE_TABLE || DEFAULT_SUPABASE_TABLE).trim() || DEFAULT_SUPABASE_TABLE;
  return { url, key, tableRaw };
}

/** Weekday name (lowercase) from raw trade `date` in Australia/Adelaide only. */
function weekdayAdelaideFromTradeDate(dateValue) {
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return null;
  return d
    .toLocaleDateString("en-AU", {
      timeZone: "Australia/Adelaide",
      weekday: "long",
    })
    .toLowerCase();
}

/** Converts a UTC date value to a human-readable Adelaide local time string. */
function formatDateAdelaide(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return String(dateValue);
  return d.toLocaleString("en-AU", {
    timeZone: "Australia/Adelaide",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Same notion as journal UI: primary cover = "Trade Photo" heading from Notion. */
function isTradePhotoCoverLabelServer(label) {
  const k = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\*/g, "");
  if (k === "trade photo") return true;
  if (!k.startsWith("trade photo")) return false;
  const rest = k.slice("trade photo".length);
  return /^[\s:]*[-–—]?\s*$/.test(rest) || /^\s*\d+\s*$/.test(rest);
}

/** Put Trade Photo first so chat + model order matches the journal. */
function sortTradeImagesPrimaryFirst(items) {
  if (!Array.isArray(items) || items.length <= 1) return items;
  const primaryIdx = items.findIndex((x) => isTradePhotoCoverLabelServer(x.label));
  if (primaryIdx <= 0) return items;
  const copy = [...items];
  const [pri] = copy.splice(primaryIdx, 1);
  return [pri, ...copy];
}

/**
 * Normalizes `trade_images` from Supabase/jsonb for the chat prompt (https URLs only).
 * @param {unknown} raw
 * @returns {{ url: string, label: string }[]}
 */
function normalizeTradeImagesForPrompt(raw) {
  let arr = raw;
  if (arr == null) return [];
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  const max = Math.max(1, MAX_TRADE_IMAGES_IN_CHAT_PROMPT);
  for (const item of arr) {
    if (out.length >= max) break;
    if (typeof item === "string") {
      const u = item.trim();
      if (/^https?:\/\//i.test(u)) out.push({ url: u, label: "" });
    } else if (item && typeof item === "object" && typeof item.url === "string") {
      const u = item.url.trim();
      if (/^https?:\/\//i.test(u)) {
        out.push({
          url: u,
          label: typeof item.label === "string" ? item.label.trim() : "",
        });
      }
    }
  }
  return sortTradeImagesPrimaryFirst(out);
}

/** User asked for every screenshot vs the normal single primary chart. */
function userWantsAllTradePhotos(messageSource) {
  const s = String(messageSource || "").trim().toLowerCase();
  return (
    /\ball\s+(the\s+)?(photos|screenshots|charts|images)\b/.test(s) ||
    /\b(every|each)\s+(photo|screenshot|chart|image)\b/.test(s) ||
    /\b(show|give|send|include)\s+me\s+all\b/.test(s) ||
    /\b(all|every)\s+of\s+(them|the charts)\b/.test(s) ||
    /\bthree\s+(photos|screenshots|charts)\b/.test(s)
  );
}

function isTradeImageHttpsUrl(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/[)\].,;!?]+$/g, "");
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return false;
    const blob = u.pathname + u.search;
    if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(blob)) return true;
    if (/\.amazonaws\.com$/i.test(u.hostname)) return true;
    if (/\.(notion\.so|notion\.site)$/i.test(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** When asking for "a photo", strip extra chart URLs the model pasted (keep first trade image only). */
function keepOnlyFirstTradeImageUrlInReply(reply, messageSource, includePhotoLinks) {
  if (!includePhotoLinks || userWantsAllTradePhotos(messageSource)) return reply;
  const text = typeof reply === "string" ? reply : "";
  const re = /https?:\/\/\S+/gi;
  let keptFirstImageUrl = false;
  const out = text.replace(re, (full) => {
    const clean = full.replace(/[)\].,;!?]+$/g, "");
    if (!isTradeImageHttpsUrl(clean)) return full;
    if (!keptFirstImageUrl) {
      keptFirstImageUrl = true;
      return full;
    }
    return "";
  });
  return out
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd();
}

/**
 * Appends raw https URLs from scoped trades when the model forgets to paste them —
 * the home chat UI only renders thumbnails when URLs appear in the reply string.
 * For a single-photo ask, only the primary URL (first after Trade Photo sort) is appended.
 */
function mergeReplyWithTradeImageUrls(
  reply,
  tradesForChat,
  photoIdxSet,
  includePhotoLinks,
  messageSource
) {
  if (!includePhotoLinks) return reply;
  const base = typeof reply === "string" ? reply : "";
  const indices =
    photoIdxSet && photoIdxSet.size ? [...photoIdxSet].sort((a, b) => a - b) : [];
  const wantsAll = userWantsAllTradePhotos(messageSource);

  if (wantsAll) {
    const toAdd = [];
    const seen = new Set();
    for (const i of indices) {
      const t = tradesForChat[i];
      if (!t || typeof t !== "object") continue;
      const imgs = normalizeTradeImagesForPrompt(t.trade_images ?? t.Trade_images);
      for (const row of imgs) {
        const url = row.url;
        if (!url || seen.has(url) || base.includes(url)) continue;
        seen.add(url);
        toAdd.push(url);
      }
    }
    if (toAdd.length === 0) return base;
    const trimmed = base.trimEnd();
    const sep = trimmed.length ? "\n\n" : "";
    return `${trimmed}${sep}${toAdd.join("\n")}`;
  }

  // Single-photo path: if Claude already cited ANY scoped trade's URL, don't append another.
  for (const i of indices) {
    const t = tradesForChat[i];
    if (!t) continue;
    const imgs = normalizeTradeImagesForPrompt(t.trade_images ?? t.Trade_images);
    for (const row of imgs) {
      if (row.url && base.includes(row.url)) return base;
    }
  }

  // Fallback: Claude didn't paste a URL. Use the highest-RR scoped trade that has images,
  // so the chart shown matches the trade most likely being discussed (not just most recent).
  let bestUrl = null;
  let bestRr = -Infinity;
  for (const i of indices) {
    const t = tradesForChat[i];
    if (!t || typeof t !== "object") continue;
    const imgs = normalizeTradeImagesForPrompt(t.trade_images ?? t.Trade_images);
    if (!imgs.length) continue;
    const rr = Number(t.rr ?? t.RR);
    const score = Number.isFinite(rr) ? rr : 0;
    if (bestUrl === null || score > bestRr) {
      bestRr = score;
      bestUrl = imgs[0].url;
    }
  }

  if (!bestUrl) return base;
  const trimmed = base.trimEnd();
  const sep = trimmed.length ? "\n\n" : "";
  return `${trimmed}${sep}${bestUrl}`;
}

/**
 * True when trade chart HTTPS URLs should be attached to the prompt / reply merge.
 * (A) Explicit show/include photo language, or (B) narrow proactive "review this trade"
 * intents — URLs are for the home chat UI thumbnails, not model vision.
 */
function userWantsTradePhotoLinks(message) {
  const s = String(message || "").trim().toLowerCase();
  if (s.length < 6) return false;

  if (
    /\b(don't|do not|never)\s+(include|show|send|give|add)\b[\s\S]{0,80}\b(photo|photos|chart|charts|screenshot|screenshots|picture|pictures|image|images)\b/i.test(
      s
    )
  ) {
    return false;
  }

  if (
    /\b(include|show|give|send|add|attach|share|link|paste)\b[\s\S]{0,120}\b(photo|photos|picture|pictures|screenshot|screenshots|chart|charts|image|images)\b/i.test(
      s
    )
  ) {
    return true;
  }

  if (
    /\b(photo|photos|chart|charts|screenshot|screenshots|picture|pictures|image|images)\b[\s\S]{0,50}\b(url|link)\b/i.test(
      s
    )
  ) {
    return true;
  }

  if (
    /\b(can you|could you|please)\b/i.test(s) &&
    /\b(include|show|add|link|send|give|attach)\b/i.test(s) &&
    /\b(photo|photos|chart|charts|screenshot|screenshots|picture|pictures|image|images)\b/i.test(s)
  ) {
    return true;
  }

  /* ── STEP 2: proactive chart context (still URL-first; capped rows below) ── */
  if (s.length >= 8) {
    const pLossWhy =
      /\bwhy\s+(did\s+i|have\s+i)\s+lose\b/.test(s) ||
      /\bwhy\s+did\s+that\s+(trade|setup)\s+(lose|fail|rip)\b/.test(s);
    const pWentWrong =
      /\bwhat\s+went\s+wrong\b/.test(s) &&
      /\b(trade|loss|setup|session|today|chart|xau|gold|entry|execution)\b/.test(s);
    const pPostMortem = /\bpost[\s-]*mortem\b/.test(s);
    const pDebrief =
      /\b(debrief|diagnos(e|ing)|break\s*down)\b/.test(s) &&
      /\b(last|recent|my|that|trade|loss|setup)\b/.test(s);
    const pReview =
      /\b(review|audit)\b/.test(s) &&
      /\b(last|recent|my)\b/.test(s) &&
      /\b(trade|loss|setup|execution)\b/.test(s);
    const pExec =
      /\b(execution|fills?|entry|exit)\b/.test(s) &&
      /\b(wrong|mistake|error|bad|off|late|early|missed)\b/.test(s) &&
      /\b(last|recent|my|that|this|trade|loss)\b/.test(s);
    const pWalk =
      /\b(walk|talk)\s+me\s+through\b/.test(s) &&
      /\b(last|recent|that|trade|loss|setup|chart)\b/.test(s);
    const pExampleCoaching =
      /\bbest\s+setup\b/.test(s) ||
      /\bbest\s+trade\b/.test(s) ||
      /\bwhat\s+does\s+my\b/.test(s) ||
      /\bshow\s+me\b/.test(s) ||
      /\bexample\s+of\b/.test(s) ||
      /\bwalk\s+me\s+through\b/.test(s) ||
      /\bwhat\s+went\s+well\b/.test(s) ||
      /\bstrongest\s+edge\b/.test(s) ||
      /\bwhat\s+does\s+a\s+good\b/.test(s) ||
      /\bperfect\s+entry\b/.test(s) ||
      /\bideal\s+setup\b/.test(s) ||
      /\byour\s+best\b/.test(s) ||
      /\brecent\s+win\b/.test(s) ||
      /\brecent\s+loss\b/.test(s) ||
      (/\b(describe|explain|break\s*down)\b/.test(s) &&
        /\b(setup|trade|entry|execution|chart)\b/.test(s));
    const pShowChart =
      /\b(show|see)\s+me\b/.test(s) && /\b(on\s+)?(the\s+)?chart\b/.test(s);
    const pChartTrade =
      /\b(chart|screenshot)\b/.test(s) &&
      /\b(last|recent|that|compare|same|this)\b/.test(s) &&
      /\b(trade|loss|setup|xau|gold)\b/.test(s);
    const pLastLoss = /\blast\s+loss\b|\bmost\s+recent\s+loss\b|\bmy\s+last\s+loss\b/.test(s);
    const pLastWin = /\blast\s+win\b|\bmost\s+recent\s+win\b|\bmy\s+last\s+win\b/.test(s);
    const pLastTrade =
      /\blast\s+trade\b|\bmost\s+recent\s+trade\b|\bmy\s+last\s+trade\b/.test(s);
    const pGold =
      /\b(xau\/?usd|xauusd|gold)\b/.test(s) &&
      /\b(last|recent|that|trade|loss|setup)\b/.test(s);
    const proactive =
      pLossWhy ||
      pWentWrong ||
      pPostMortem ||
      pDebrief ||
      pReview ||
      pExec ||
      pWalk ||
      pExampleCoaching ||
      pShowChart ||
      pChartTrade ||
      pLastLoss ||
      pLastWin ||
      pLastTrade ||
      pGold;
    if (proactive) return true;
  }

  return false;
}

/** Normalized instrument key for substring match (e.g. XAUUSD). */
function tradePairNormForPhoto(t) {
  return String(t?.pair ?? t?.Pair ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Newest-first row index when the user names an instrument (XAU, EURUSD, etc.). */
function findTradeIndexByInstrumentMention(arr, messageLower) {
  const u = String(messageLower || "").toUpperCase();
  if (/\b(XAU\/?USD|XAUUSD|GOLD)\b/.test(u)) {
    const ix = arr.findIndex((t) => {
      const p = tradePairNormForPhoto(t);
      return p.includes("XAU") || p.includes("GOLD");
    });
    if (ix >= 0) return ix;
  }
  const m = u.match(/\b([A-Z]{3})\/?([A-Z]{3})\b/);
  if (m) {
    const needle = `${m[1]}${m[2]}`.replace(/[^A-Z]/g, "");
    if (needle.length >= 6) {
      const ix = arr.findIndex((t) => {
        const p = tradePairNormForPhoto(t);
        if (!p) return false;
        return p.includes(needle) || needle.includes(p);
      });
      if (ix >= 0) return ix;
    }
  }
  return -1;
}

/** Newest-first index of the single highest-R trade in the list. */
function findBestRrTradeIndex(arr) {
  let bestIx = -1;
  let bestRr = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const rr = Number(arr[i]?.rr);
    if (Number.isFinite(rr) && rr > bestRr) {
      bestRr = rr;
      bestIx = i;
    }
  }
  return bestIx;
}

/** Newest-first indices of the top N trades by RR (ties broken by recency). */
function findTopRrTradeIndices(arr, n = 5) {
  const ranked = [];
  for (let i = 0; i < arr.length; i++) {
    const rr = Number(arr[i]?.rr);
    if (Number.isFinite(rr)) ranked.push({ i, rr });
  }
  ranked.sort((a, b) => b.rr - a.rr || a.i - b.i);
  const out = [];
  for (const { i } of ranked) {
    if (out.length >= n) break;
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

const TRADE_IMAGES_ROW_MATCH_RULE =
  "Each trade row in the data may contain a trade_images array. When you reference a specific trade by date, look at that trade's row in the data and use the URL from ITS trade_images field. Never use another trade's image URL. Paste it on its own line after mentioning the trade.";

/**
 * Pinned + high-R rows that should carry `trade_images` so examples map to the right chart.
 * Priority order before cap: most recent, last win/loss, best RR, top 5 RR, then all RR > 3.0 (by RR desc).
 */
function tradeChartContextIndices(tradesForChat) {
  const arr = Array.isArray(tradesForChat) ? tradesForChat : [];
  const ordered = [];

  const push = (i) => {
    if (typeof i === "number" && i >= 0 && i < arr.length && !ordered.includes(i)) {
      ordered.push(i);
    }
  };

  const idxWin = arr.findIndex((t) =>
    String(t.outcome || "").toLowerCase().includes("win")
  );
  const idxLoss = arr.findIndex((t) =>
    String(t.outcome || "").toLowerCase().includes("loss")
  );
  const idxBestRr = findBestRrTradeIndex(arr);

  push(0);
  push(idxWin);
  push(idxLoss);
  push(idxBestRr);
  for (const i of findTopRrTradeIndices(arr, 5)) push(i);

  const highRr = [];
  for (let i = 0; i < arr.length; i++) {
    const rr = Number(arr[i]?.rr);
    if (Number.isFinite(rr) && rr > 3) highRr.push({ i, rr });
  }
  highRr.sort((a, b) => b.rr - a.rr || a.i - b.i);
  for (const { i } of highRr) push(i);

  return new Set(ordered.slice(0, MAX_TRADES_WITH_PHOTO_LINKS_IN_CHAT));
}

/**
 * Which rows in `tradesForChat` (newest first) should include `trade_images` URLs.
 * Notion signed URLs are massive — attaching them to every row exceeds model context limits.
 */
function tradePhotoLinkIndices(tradesForChat, messageSource) {
  const arr = Array.isArray(tradesForChat) ? tradesForChat : [];
  const s = String(messageSource || "").trim().toLowerCase();
  const indices = new Set(tradeChartContextIndices(arr));

  const add = (i) => {
    if (typeof i === "number" && i >= 0 && i < arr.length) indices.add(i);
  };

  const idxWin = arr.findIndex((t) =>
    String(t.outcome || "").toLowerCase().includes("win")
  );
  const idxLoss = arr.findIndex((t) =>
    String(t.outcome || "").toLowerCase().includes("loss")
  );
  const idxBe = arr.findIndex(
    (t) =>
      String(t.outcome || "").toLowerCase().includes("be") ||
      String(t.outcome || "").toLowerCase().includes("break")
  );

  if (
    /\blast\s+win\b|\bmost\s+recent\s+win\b|\bmy\s+last\s+win\b/.test(s) ||
    /\bphoto\b[\s\S]{0,120}\blast\s+win\b|\blast\s+win\b[\s\S]{0,120}\bphoto\b/.test(s)
  ) {
    add(idxWin);
  }

  if (
    /\blast\s+loss\b|\bmost\s+recent\s+loss\b|\bmy\s+last\s+loss\b/.test(s) ||
    /\bphoto\b[\s\S]{0,120}\blast\s+loss\b|\blast\s+loss\b[\s\S]{0,120}\bphoto\b/.test(s)
  ) {
    add(idxLoss);
  }

  if (
    /\blast\s+(be|breakeven|break\s*even)\b|\bmost\s+recent\s+(be|breakeven|break)/.test(s)
  ) {
    add(idxBe);
  }

  if (
    /\blast\s+trade\b|\bmost\s+recent\s+trade\b|\bmy\s+last\s+trade\b/.test(s) ||
    /\bphoto\b[\s\S]{0,120}\blast\s+trade\b|\blast\s+trade\b[\s\S]{0,120}\bphoto\b/.test(s) ||
    /\bchart\b[\s\S]{0,120}\blast\s+trade\b|\blast\s+trade\b[\s\S]{0,120}\bchart\b/.test(s)
  ) {
    add(0);
  }

  const dayNames = [
    "wednesday",
    "tuesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "monday",
  ];
  for (const d of dayNames) {
    if (
      new RegExp(`\\blast\\s+${d}\\b|\\b${d}'?s\\s+(trade|trades|setup)\\b`).test(s)
    ) {
      const ix = arr.findIndex((t) => String(t.weekday || "").toLowerCase() === d);
      add(ix);
      break;
    }
  }

  const pairIx = findTradeIndexByInstrumentMention(arr, s);
  if (pairIx >= 0) add(pairIx);

  if (indices.size === 0 && arr.length > 0) {
    const wantsLossRow =
      /\bwhy\s+(did\s+i|have\s+i)\s+lose\b/.test(s) ||
      (/\bwhat\s+went\s+wrong\b/.test(s) &&
        /\b(trade|loss|setup|session|today|chart|xau|gold|entry|execution)\b/.test(s)) ||
      /\bpost[\s-]*mortem\b/.test(s);
    if (wantsLossRow && idxLoss >= 0) add(idxLoss);
    else add(0);
  }

  const sorted = [...indices]
    .sort((a, b) => a - b)
    .slice(0, MAX_TRADES_WITH_PHOTO_LINKS_IN_CHAT);
  return new Set(sorted);
}

function parseNotionExtras(raw) {
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

function truncateExtrasObject(obj, maxChars) {
  const keys = Object.keys(obj);
  const out = {};
  for (const k of keys) {
    const trial = { ...out, [k]: obj[k] };
    if (JSON.stringify(trial).length <= maxChars) out[k] = obj[k];
    else break;
  }
  return Object.keys(out).length ? out : null;
}

function userRequestsNotionExtrasDepth(messageSource) {
  const s = String(messageSource || "").toLowerCase();
  return NOTION_EXTRAS_TRIGGER_WORDS.some((w) => s.includes(w));
}

function messageMatchesExtrasKeys(tradesForChat, messageSource) {
  const arr = Array.isArray(tradesForChat) ? tradesForChat : [];
  const s = String(messageSource || "").toLowerCase();
  const words = s.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (words.length === 0) return false;
  const scan = Math.min(arr.length, 20);
  for (let i = 0; i < scan; i++) {
    const ex = parseNotionExtras(arr[i]?.notion_extras);
    if (!ex) continue;
    for (const k of Object.keys(ex)) {
      const kl = k.toLowerCase();
      const slug = kl.replace(/[^a-z0-9]+/g, "");
      if (
        words.some(
          (w) =>
            (w.length >= 4 && kl.includes(w)) ||
            (slug.length >= 5 && (slug.includes(w) || w.includes(slug)))
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Which rows should include a selective `notion_extras` slice (newest-first indices).
 * Scoped by explicit trade references (last win/loss/trade/BE/weekday), broad “all trades”
 * analytics, property-name matches — not photo-link heuristics (avoids attaching extras on
 * every vague chart request).
 */
function tradeNotionExtrasIndices(tradesForChat, messageSource) {
  const arr = Array.isArray(tradesForChat) ? tradesForChat : [];
  const s = String(messageSource || "").trim().toLowerCase();
  const indices = new Set();

  const add = (i) => {
    if (typeof i === "number" && i >= 0 && i < arr.length) indices.add(i);
  };

  const idxWin = arr.findIndex((t) =>
    String(t.outcome || "").toLowerCase().includes("win")
  );
  const idxLoss = arr.findIndex((t) =>
    String(t.outcome || "").toLowerCase().includes("loss")
  );
  const idxBe = arr.findIndex(
    (t) =>
      String(t.outcome || "").toLowerCase().includes("be") ||
      String(t.outcome || "").toLowerCase().includes("break")
  );

  if (
    /\blast\s+win\b|\bmost\s+recent\s+win\b|\bmy\s+last\s+win\b/.test(s)
  ) {
    add(idxWin);
  }

  if (
    /\blast\s+loss\b|\bmost\s+recent\s+loss\b|\bmy\s+last\s+loss\b/.test(s)
  ) {
    add(idxLoss);
  }

  if (
    /\blast\s+(be|breakeven|break\s*even)\b|\bmost\s+recent\s+(be|breakeven|break)/.test(
      s
    )
  ) {
    add(idxBe);
  }

  if (
    /\blast\s+trade\b|\bmost\s+recent\s+trade\b|\bmy\s+last\s+trade\b/.test(s)
  ) {
    add(0);
  }

  const dayNames = [
    "wednesday",
    "tuesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "monday",
  ];
  for (const d of dayNames) {
    if (
      new RegExp(`\\blast\\s+${d}\\b|\\b${d}'?s\\s+(trade|trades|setup)\\b`).test(s)
    ) {
      const ix = arr.findIndex((t) => String(t.weekday || "").toLowerCase() === d);
      add(ix);
      break;
    }
  }

  const broad =
    /\b(all|every|each|across|patterns?|distribution|usually|typically|often|stats|trends?|overall)\b/i.test(
      s
    );
  if (broad && arr.length > 0) {
    const cap = Math.min(arr.length, MAX_TRADES_WITH_NOTION_EXTRAS_IN_CHAT);
    for (let i = 0; i < cap; i++) add(i);
  }

  const words = s.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  for (
    let i = 0;
    i < Math.min(arr.length, MAX_TRADES_WITH_NOTION_EXTRAS_IN_CHAT);
    i++
  ) {
    const ex = parseNotionExtras(arr[i]?.notion_extras);
    if (!ex) continue;
    for (const k of Object.keys(ex)) {
      const kl = k.toLowerCase();
      const slug = kl.replace(/[^a-z0-9]+/g, "");
      if (
        words.some(
          (w) =>
            (w.length >= 4 && kl.includes(w)) ||
            (slug.length >= 5 && (slug.includes(w) || w.includes(slug)))
        )
      ) {
        add(i);
        break;
      }
    }
  }

  if (indices.size === 0 && arr.length > 0) {
    if (
      userRequestsNotionExtrasDepth(messageSource) ||
      messageMatchesExtrasKeys(tradesForChat, messageSource)
    ) {
      add(0);
    }
  }

  return new Set(
    [...indices]
      .sort((a, b) => a - b)
      .slice(0, MAX_TRADES_WITH_NOTION_EXTRAS_IN_CHAT)
  );
}

function pickNotionExtrasSlice(raw, messageSource) {
  const extras = parseNotionExtras(raw);
  if (!extras || typeof extras !== "object") return null;
  const s = String(messageSource || "").toLowerCase();
  const words = s.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const keys = Object.keys(extras).sort();
  const picked = {};

  for (const k of keys) {
    const kl = k.toLowerCase();
    const slug = kl.replace(/[^a-z0-9]+/g, "");
    const nameMatch = words.some(
      (w) =>
        (w.length >= 4 && kl.includes(w)) ||
        (slug.length >= 5 && (slug.includes(w) || w.includes(slug)))
    );
    if (nameMatch) picked[k] = extras[k];
  }

  let result =
    Object.keys(picked).length > 0
      ? picked
      : userRequestsNotionExtrasDepth(messageSource)
        ? (() => {
            const hs = keys.filter((k) => notionKeyMatchesHighSignal(k));
            const pickKeys = hs.length > 0 ? hs : keys;
            return Object.fromEntries(
              pickKeys.slice(0, 14).map((k) => [k, extras[k]])
            );
          })()
        : null;

  if (!result || Object.keys(result).length === 0) return null;

  result = truncateExtrasObject(result, MAX_NOTION_EXTRAS_CHARS_PER_TRADE);
  return result && Object.keys(result).length > 0 ? result : null;
}

/** Small allowlist for chat system JSON — avoids huge Supabase payloads. */
function slimTradeRowForPrompt(t, options = {}) {
  if (!t || typeof t !== "object") return t;
  const includeTradeImages = !!options.includeTradeImages;
  const readField = (obj, keys) => {
    for (const k of keys) {
      if (obj?.[k] !== undefined) return obj[k];
    }
    return undefined;
  };
  let notes = t.notes == null ? "" : String(t.notes);
  if (notes.length > MAX_PROMPT_TRADE_NOTES_CHARS) {
    notes = `${notes.slice(0, MAX_PROMPT_TRADE_NOTES_CHARS)}…`;
  }
  const rawDate = readField(t, ["date", "Date"]);
  const row = {
    date: rawDate,
    date_local: formatDateAdelaide(rawDate),
    weekday: readField(t, ["weekday", "Weekday"]),
    session: readField(t, ["session", "SESSION", "Session"]) ?? "",
    pair: readField(t, ["pair", "Pair", "PAIR", "instrument", "symbol"]) ?? "",
    outcome: readField(t, ["outcome", "Outcome", "OUTCOME"]) ?? "",
    rr: readField(t, ["rr", "RR"]) ?? null,
    model: readField(t, ["model", "MODEL", "Model"]) ?? "",
    account: readField(t, ["account", "Account", "ACCOUNT"]) ?? "",
    direction: readField(t, ["direction", "Direction", "DIRECTION"]) ?? "",
    notes,
  };
  if (includeTradeImages) {
    const imgs = normalizeTradeImagesForPrompt(readField(t, ["trade_images", "Trade_images"]));
    if (imgs.length > 0) row.trade_images = imgs;
  }
  const slice = options.notionExtrasSlice;
  if (slice && typeof slice === "object" && Object.keys(slice).length > 0) {
    row.notion_extras = slice;
  }
  return row;
}

function buildProfileEvidenceBundle(allTradesSlimmed, maxExamples = 30) {
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const max = clamp(Number(maxExamples) || 0, 0, 60);
  const examples = Array.isArray(allTradesSlimmed)
    ? allTradesSlimmed.slice(0, max).map((t) => ({
        date_local: t?.date_local || "",
        weekday: t?.weekday || "",
        session: t?.session || "",
        pair: t?.pair || "",
        model: t?.model || "",
        outcome: t?.outcome || "",
        rr: t?.rr ?? null,
        account: t?.account || "",
        notes: t?.notes || "",
      }))
    : [];

  const notesWithDates = examples
    .filter((t) => t.notes && String(t.notes).trim())
    .slice(0, 12)
    .map((t) => ({
      date_local: t.date_local,
      pair: t.pair,
      model: t.model,
      outcome: t.outcome,
      rr: t.rr,
      notes: t.notes,
    }));

  return { examples, notesWithDates };
}

/**
 * Rows from Jarvis_data_source, newest `date` first (PostgREST).
 * Uses the same table as fetchTradesFromSupabase so snapshot and chat stats match.
 * @param {string} userId
 * @param {{ limit?: number, includeArchived?: boolean }} [options]
 */
async function getRecentTrades(userId, options = {}) {
  const { url, key, tableRaw } = getSupabaseConfig();
  if (!url || !key) {
    const err = new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env next to server.mjs."
    );
    err.code = "SUPABASE_CONFIG";
    throw err;
  }

  const limit = Math.min(
    Math.max(1, Number(options.limit) || 20),
    MAX_SUPABASE_ROWS
  );
  const tableEnc = encodeURIComponent(tableRaw);
  const includeArchived = options.includeArchived === true;
  const archQ =
    TRADE_ARCHIVED_ACTIVE && !includeArchived ? "&archived=is.false" : "";
  const endpoint = `${url}/rest/v1/${tableEnc}?select=*&auth_user_id=eq.${encodeURIComponent(userId)}&order=date.desc&limit=${limit}${archQ}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(
      formatSupabaseError(text, res.status) || `Supabase HTTP ${res.status}`
    );
    err.code = "SUPABASE_HTTP";
    err.status = res.status;
    throw err;
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    const err = new Error("Invalid JSON from Supabase");
    err.code = "SUPABASE_PARSE";
    throw err;
  }

  if (!Array.isArray(rows)) {
    const err = new Error("Supabase response was not a JSON array");
    err.code = "SUPABASE_SHAPE";
    throw err;
  }

  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  rows = rows.map((row) => ({
    ...row,
    weekday: weekdayAdelaideFromTradeDate(row.date),
  }));

  console.log("=== RAW TRADES ===", rows.length);

  return rows;
}

/**
 * Converts Supabase/PostgREST rows to the same shape as browser CSV parsing:
 * `{ headers: string[], records: Record<string,string>[] }`.
 */
function rowsToTradesPayload(rows) {
  if (!Array.isArray(rows)) {
    return { headers: [], records: [] };
  }

  if (rows.length === 0) {
    return { headers: [], records: [] };
  }

  const headers = Object.keys(rows[0]);

  const records = rows.map((row) => {
    const rec = {};
    for (const h of headers) {
      const v = row[h];
      if (v === null || v === undefined) {
        rec[h] = "";
      } else if (typeof v === "object") {
        // Keep jsonb / arrays (e.g. trade_images) as parseable JSON for journal UI.
        rec[h] = JSON.stringify(v);
      } else {
        rec[h] = String(v);
      }
    }
    return rec;
  });

  return { headers, records };
}

/**
 * Fetches trading rows from Supabase REST (anon key, server-side only).
 * @param {string} userId
 * @param {{ includeArchived?: boolean }} [options]
 */
async function fetchTradesFromSupabase(userId, options = {}) {
  const { url, key, tableRaw } = getSupabaseConfig();
  if (!url || !key) {
    const err = new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env next to server.mjs."
    );
    err.code = "SUPABASE_CONFIG";
    throw err;
  }

  const tableEnc = encodeURIComponent(tableRaw);
  const includeArchived = options.includeArchived === true;
  const archQ =
    TRADE_ARCHIVED_ACTIVE && !includeArchived ? "&archived=is.false" : "";
  const endpoint = `${url}/rest/v1/${tableEnc}?select=*&auth_user_id=eq.${encodeURIComponent(userId)}${archQ}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      Range: `0-${MAX_SUPABASE_ROWS - 1}`,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(
      formatSupabaseError(text, res.status) || `Supabase HTTP ${res.status}`
    );
    err.code = "SUPABASE_HTTP";
    err.status = res.status;
    throw err;
  }

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    const err = new Error("Invalid JSON from Supabase");
    err.code = "SUPABASE_PARSE";
    throw err;
  }

  if (!Array.isArray(rows)) {
    const err = new Error("Supabase response was not a JSON array");
    err.code = "SUPABASE_SHAPE";
    throw err;
  }

  console.log("SERVER ROWS LENGTH:", rows.length);

  const payload = rowsToTradesPayload(rows);
  payload.snapshot = deriveTradingSnapshot(rows.map(slimTradeRowForPrompt));
  console.log("SERVER PAYLOAD:", payload.records.length);

  return payload;
}

function formatSupabaseError(responseText, status) {
  try {
    const j = JSON.parse(responseText);
    if (j.message && typeof j.message === "string") return j.message;
    if (j.error && typeof j.error === "string") return j.error;
    if (j.hint && typeof j.hint === "string") return j.hint;
  } catch {
    /* not JSON */
  }
  return responseText?.trim() || "";
}

async function handleSyncNotion(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const syncMeta = await maybeSyncNotion(userId, { force: true });
    if (syncMeta.ok && !syncMeta.skipped) {
      firePostSyncBrain(userId);
      json(res, 200, {
        success: true,
        fetched: syncMeta.fetched,
        upserted: syncMeta.upserted,
      });
      return;
    }
    if (syncMeta.skipped && syncMeta.oauthRequired) {
      json(res, 404, {
        success: false,
        error:
          syncMeta.reason === "no_mapping"
            ? "No column mapping — complete /notion-setup.html"
            : "No Notion connection — connect at /notion-setup.html",
      });
      return;
    }
    json(res, syncMeta.oauthAuthError ? 401 : 502, {
      success: false,
      error: syncMeta.reason || "Sync failed",
    });
  } catch (e) {
    console.error("[notion-sync]", e);
    json(res, 500, {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function handleAnalysisEngine(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const t0 = Date.now();
    const report = await runAnalysisEngine(userId);
    console.log(`[analysis-engine] user=${userId} trades=${report.tradeCount} ms=${Date.now() - t0}`);
    json(res, 200, report);
  } catch (e) {
    console.error("[analysis-engine]", e);
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleIntelligenceFile(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const file = await getIntelligenceFile(userId);
    json(res, 200, file);
  } catch (e) {
    console.error("[intelligence-file]", e);
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleRegenerateIntelligence(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const t0 = Date.now();
    const file = await generateIntelligenceFile(userId);
    console.log(`[intelligence-file] forced regen for ${userId} ms=${Date.now() - t0}`);
    json(res, 200, { ok: true, version: file.version, tradeCount: file.tradeCount, generatedAt: file.generatedAt });
  } catch (e) {
    console.error("[intelligence-file] regen error", e);
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleTrades(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const includeArchived = u.searchParams.get("include_archived") === "1";
    const tDb = Date.now();
    const payload = await fetchTradesFromSupabase(userId, { includeArchived });
    if (process.env.JARVIS_PERF_LOG === "1") {
      console.log(
        `[perf] GET /api/trades user=${userId} dbMs=${Date.now() - tDb} rows=${payload.records.length}`
      );
    }
    if (!payload.records.length) {
      json(res, 200, payload);
      return;
    }
    json(res, 200, payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e?.code;
    const status =
      code === "SUPABASE_CONFIG"
        ? 503
        : e?.status >= 400 && e?.status < 600
          ? e.status
          : 502;
    json(res, status, { error: msg, code: code || "SUPABASE" });
  }
}

async function handleSnapshot(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }

    const tDb = Date.now();
    const trades = await getRecentTrades(userId, { limit: MAX_SUPABASE_ROWS });
    const tradesForPrompt = trades.map(slimTradeRowForPrompt);

    const snapshot = deriveTradingSnapshot(tradesForPrompt);
    if (process.env.JARVIS_PERF_LOG === "1") {
      console.log(
        `[perf] GET /api/snapshot user=${userId} dbMs=${Date.now() - tDb} trades=${trades.length}`
      );
    }
    json(res, 200, { userId, snapshot });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e?.code;
    const status =
      code === "SUPABASE_CONFIG"
        ? 503
        : e?.status >= 400 && e?.status < 600
          ? e.status
          : 502;
    json(res, status, { error: msg, code: code || "SNAPSHOT" });
  }
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleBriefing(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: "Request body too large" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const userId = authUserIdFromReq(req);
  if (!userId) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  let trades;
  try {
    trades = await getRecentTrades(userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e?.code;
    const status =
      code === "SUPABASE_CONFIG"
        ? 503
        : e?.status >= 400 && e?.status < 600
          ? e.status
          : 502;
    json(res, status, { error: msg, code: code || "SUPABASE" });
    return;
  }

  console.log("[/api/briefing] getRecentTrades count:", trades.length, "first trade:", trades[0]);

  const headers = Array.isArray(payload.headers) ? payload.headers : [];

  if (!Array.isArray(trades) || trades.length === 0) {
    json(res, 400, { error: "Expected non-empty \"trades\" array" });
    return;
  }

  const apiKey =
    (typeof payload.apiKey === "string" && payload.apiKey.trim()) ||
    process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    json(res, 401, {
      error:
        "No API key. Set ANTHROPIC_API_KEY in a .env file next to server.mjs (see .env.example) or send apiKey in the request body for local testing.",
    });
    return;
  }

  const tradesForBriefing = trades.slice(0, MAX_BRIEFING_TRADES);
  const columnKeys = headers.length ? headers : Object.keys(tradesForBriefing[0] ?? trades[0] ?? {});
  const userContent = buildMessagesUserContent(columnKeys, tradesForBriefing);

  /** Anthropic Messages API only — not Completions. */
  const anthropicBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  };

  let ar;
  try {
    ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    json(res, 502, { error: `Anthropic request failed: ${String(e.message ?? e)}` });
    return;
  }

  const responseText = await ar.text();
  if (!ar.ok) {
    json(res, ar.status >= 400 && ar.status < 600 ? ar.status : 502, {
      error: formatAnthropicClientError(responseText) || `Anthropic HTTP ${ar.status}`,
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    json(res, 502, { error: "Invalid JSON from Anthropic" });
    return;
  }

  const briefing = extractAssistantText(data);

  json(res, 200, { briefing });
}

/**
 * Validates alternating user/assistant turns; last message must be user (awaiting reply).
 */
function normalizeChatMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { role, content } = m;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;
    out.push({ role, content });
  }
  if (out.length === 0) return null;
  if (out[0].role !== "user") return null;
  for (let i = 1; i < out.length; i++) {
    if (out[i].role === out[i - 1].role) return null;
  }
  if (out[out.length - 1].role !== "user") return null;
  return out;
}

/** Keeps last N alternating messages ending with user; trims oversized bodies. */
function clampChatMessagesForTokens(msgs, maxMsgs = MAX_CHAT_MESSAGES) {
  const trimContent = (c) =>
    c.length <= MAX_CHAT_MESSAGE_CHARS
      ? c
      : `${c.slice(0, MAX_CHAT_MESSAGE_CHARS)}\n[truncated]`;

  const trimmed = msgs.map((m) => ({
    role: m.role,
    content: trimContent(m.content),
  }));

  if (trimmed.length <= maxMsgs) return trimmed;

  const last = trimmed[trimmed.length - 1];
  if (last.role !== "user") {
    return [{ role: last.role, content: trimContent(last.content) }];
  }

  const out = [{ role: last.role, content: last.content }];
  for (let i = trimmed.length - 2; i >= 0 && out.length < maxMsgs; i -= 1) {
    const need = out[0].role === "user" ? "assistant" : "user";
    if (trimmed[i].role !== need) break;
    out.unshift({
      role: trimmed[i].role,
      content: trimmed[i].content,
    });
  }
  return out;
}

async function handleChat(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: "Request body too large" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const userId = authUserIdFromReq(req);
  if (!userId) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  const messageSource =
    typeof payload.message === "string"
      ? payload.message
      : Array.isArray(payload.messages)
        ? (() => {
            for (let i = payload.messages.length - 1; i >= 0; i--) {
              const m = payload.messages[i];
              if (m?.role === "user" && typeof m.content === "string") {
                return m.content;
              }
            }
            return "";
          })()
        : "";
  const message = messageSource.toLowerCase();

  const includePhotoLinks = userWantsTradePhotoLinks(messageSource);

  const sessions = ["asia", "london", "new york"];
  const requestedSession = sessions.find((s) => message.includes(s));

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const requestedDay = [...dayNames]
    .sort((a, b) => b.length - a.length)
    .find((d) => message.includes(d));

  let messages = normalizeChatMessages(payload.messages);

  if (!messages) {
    json(res, 400, {
      error:
        "Expected messages: non-empty array alternating user/assistant, starting and ending with user",
    });
    return;
  }

  const profilePromise = fetchUserProfile(userId);
  const memoriesPromise = getRelevantMemories(userId, messageSource);
  const intelligencePromise = getIntelligenceFile(userId).catch((e) => {
    console.warn("[chat] intelligence file fetch failed:", e.message);
    return null;
  });
  const deepThinkPromise = getDeepThinkForPrompt(userId).catch((e) => {
    console.warn("[chat] deep-think fetch failed:", e.message);
    return "";
  });
  void maybeSyncNotion(userId, { force: true });

  let trades;
  try {
    trades = await getRecentTrades(userId, {
      limit: CHAT_TRADE_FETCH_LIMIT,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e?.code;
    const status =
      code === "SUPABASE_CONFIG"
        ? 503
        : e?.status >= 400 && e?.status < 600
          ? e.status
          : 502;
    json(res, status, { error: msg, code: code || "SUPABASE" });
    return;
  }

  let filteredTrades = trades;

  if (requestedDay) {
    filteredTrades = filteredTrades.filter(
      (t) => t.weekday === requestedDay
    );
  }

  if (requestedSession) {
    filteredTrades = filteredTrades.filter((t) =>
      String(t.session || "").toLowerCase().includes(requestedSession)
    );
  }

  const filtersApplied = !!requestedDay || !!requestedSession;

  if (!Array.isArray(trades) || trades.length === 0) {
    json(res, 400, { error: "Expected non-empty \"trades\" array" });
    return;
  }

  if (filtersApplied && filteredTrades.length === 0) {
    filteredTrades = trades;
  }

  const tradesForChat = filtersApplied ? filteredTrades : trades;

  const wantsNotionExtras =
    userRequestsNotionExtrasDepth(messageSource) ||
    messageMatchesExtrasKeys(tradesForChat, messageSource);
  const extrasIdxSet = wantsNotionExtras
    ? tradeNotionExtrasIndices(tradesForChat, messageSource)
    : new Set();

  const includeNotionAggregates = messageRequestsNotionAggregates(messageSource);
  const notionAggregateSummary = includeNotionAggregates
    ? buildNotionExtrasAggregateSummary(tradesForChat)
    : null;

  const mostRecentTrade = tradesForChat[0];

  const mostRecentLoss = tradesForChat.find((t) =>
    String(t.outcome || "").toLowerCase().includes("loss")
  );

  const mostRecentWin = tradesForChat.find((t) =>
    String(t.outcome || "").toLowerCase().includes("win")
  );

  const mostRecentBE = tradesForChat.find(
    (t) =>
      String(t.outcome || "").toLowerCase().includes("be") ||
      String(t.outcome || "").toLowerCase().includes("break")
  );

  const chartContextIdxSet = tradeChartContextIndices(tradesForChat);
  const photoIdxSet = includePhotoLinks
    ? tradePhotoLinkIndices(tradesForChat, messageSource)
    : chartContextIdxSet;

  const slimOptsAt = (i) => {
    const o = {};
    if (photoIdxSet.has(i)) o.includeTradeImages = true;
    if (wantsNotionExtras && extrasIdxSet.has(i)) {
      const slice = pickNotionExtrasSlice(
        tradesForChat[i]?.notion_extras,
        messageSource
      );
      if (slice && Object.keys(slice).length > 0) o.notionExtrasSlice = slice;
    }
    return o;
  };

  if (photoIdxSet.size > 0) {
    console.log(
      `[chat] trade chart context (0=newest): ${
        [...photoIdxSet].sort((a, b) => a - b).map(i => {
          const t = tradesForChat[i];
          if (!t) return `${i}:?`;
          const hasImg = Array.isArray(t.trade_images) ? t.trade_images.length > 0 : !!t.trade_images;
          const d = t.date_local || t.date || "?";
          const label = `${i}:${String(t.pair||"?").replace("/","")} RR:${t.rr??"?"} ${String(t.outcome||"?").slice(0,1).toUpperCase()} ${hasImg?"📷":"no-img"}`;
          return label;
        }).join(" | ")
      }`
    );
  }
  if (wantsNotionExtras) {
    console.log(
      `[chat] notion_extras slices — rows (0=newest): ${[...extrasIdxSet].sort((a, b) => a - b).join(",")}`
    );
  }

  // Build pinned trades (most recent, last win, last loss, best RR) — always include images
  const bestRRTrade = trades.reduce(
    (best, t) => (Number(t.rr) > Number(best?.rr ?? -Infinity) ? t : best),
    null
  );

  const pinnedTrades = {
    mostRecent: mostRecentTrade ? slimTradeRowForPrompt(mostRecentTrade, { includeTradeImages: true }) : null,
    lastWin: mostRecentWin ? slimTradeRowForPrompt(mostRecentWin, { includeTradeImages: true }) : null,
    lastLoss: mostRecentLoss ? slimTradeRowForPrompt(mostRecentLoss, { includeTradeImages: true }) : null,
    bestRR: bestRRTrade ? slimTradeRowForPrompt(bestRRTrade, { includeTradeImages: true }) : null,
  };

  // Dynamic context: up to 15 slim rows when session/day filter is active
  const dynamicRows = filtersApplied
    ? tradesForChat.slice(0, 15).map((t) => slimTradeRowForPrompt(t, {}))
    : [];

  console.log(
    `[chat] pinned: recent=${!!pinnedTrades.mostRecent} win=${!!pinnedTrades.lastWin} loss=${!!pinnedTrades.lastLoss} bestRR=${pinnedTrades.bestRR?.rr ?? "none"} | dynamic rows: ${dynamicRows.length} (session="${requestedSession || "none"}" day="${requestedDay || "none"}")`
  );

  messages = clampChatMessagesForTokens(messages, MAX_CHAT_MESSAGES);

  // Await profile, memories, and intelligence file
  const userProfile = await profilePromise.catch(() => null);
  const relevantMemories = await memoriesPromise.catch(() => []);
  const intelFile = await intelligencePromise;
  const deepThinkText = await deepThinkPromise;
  const memoriesBlock = formatMemoriesForPrompt(relevantMemories);

  const apiKey =
    (typeof payload.apiKey === "string" && payload.apiKey.trim()) ||
    process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    json(res, 401, {
      error:
        "No API key. Set ANTHROPIC_API_KEY in a .env file next to server.mjs (see .env.example) or send apiKey in the request body for local testing.",
    });
    return;
  }

  const useWebSearch = needsWebSearch(messageSource);
  console.log(
    `[web-search] ${useWebSearch ? "TRIGGERED" : "not triggered"} — query: "${messageSource.slice(0, 120)}"`
  );

  const system =
    buildJarvisChatSystem(
      intelFile,
      userProfile,
      pinnedTrades,
      dynamicRows,
      deepThinkText
    ) +
    (memoriesBlock ? `\n\n${memoriesBlock}` : "") +
    (useWebSearch
      ? "\n\nYou have a real-time web_search tool available in this conversation. When the user asks about current gold prices, market prices, news, economic events, or any live market data — CALL the web_search tool immediately to look it up before responding. Do not tell the user you have no access to live data; you do have access via web_search."
      : "") +
    (photoIdxSet.size > 0
      ? `\n\nTRADE PHOTOS — ${TRADE_IMAGES_ROW_MATCH_RULE} Pinned trades have images attached (most recent, last win, last loss, best RR). Match the row using date_local, session, pair, and direction.`
      : "") +
    (includePhotoLinks
      ? " Chart context is ON (screenshot/review intent). Paste full HTTPS URLs on their own lines so the HUD can render thumbnails; do not claim to see pixels."
      : "") +
    (wantsNotionExtras
      ? "\n\nNOTION EXTRAS — Some trades may include a selective \"notion_extras\" object (extra Notion fields). It appears only when the user asked about dimensions beyond core stats (psychology, timeframes, volume, tags, etc.). Use these values when present; do not invent fields."
      : "") +
    (notionAggregateSummary
      ? `\n\nNOTION FIELD AGGREGATES (high-signal keys only; broad coaching / stats questions):\n${notionAggregateSummary.sentence}\n${notionAggregateSummary.json}`
      : "");

  const anthropicBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_CHAT_OUTPUT_TOKENS,
    system,
    messages,
  };

  if (useWebSearch) {
    anthropicBody.tools = [{ type: "web_search_20250305", name: "web_search" }];
    console.log("[web-search] Tools array:", JSON.stringify(anthropicBody.tools));
  }

  const requestHeaders = {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };

  if (useWebSearch) {
    requestHeaders["anthropic-beta"] = "web-search-2025-03-05";
    console.log("[web-search] Beta header: web-search-2025-03-05");
  }

  console.log('[chat] estimated tokens:', Math.round(system.length / 4));

  let ar;
  try {
    ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(anthropicBody),
    });
  } catch (e) {
    json(res, 502, { error: `Anthropic request failed: ${String(e.message ?? e)}` });
    return;
  }

  const responseText = await ar.text();
  if (!ar.ok) {
    json(res, ar.status >= 400 && ar.status < 600 ? ar.status : 502, {
      error: formatAnthropicClientError(responseText) || `Anthropic HTTP ${ar.status}`,
    });
    return;
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    json(res, 502, { error: "Invalid JSON from Anthropic" });
    return;
  }

  let reply = extractAssistantText(data);
  reply = keepOnlyFirstTradeImageUrlInReply(reply, messageSource, includePhotoLinks);
  reply = mergeReplyWithTradeImageUrls(
    reply,
    tradesForChat,
    photoIdxSet,
    includePhotoLinks,
    messageSource
  );
  json(res, 200, { reply });

  // Background profile update — fire-and-forget, never blocks the response
  void generateAndUpdateProfile(
    userId,
    messages,
    reply,
    userProfile,
    tradesForChat.map((t) => slimTradeRowForPrompt(t)),
    apiKey
  ).catch((e) =>
    console.warn("[profile-update] Background update failed:", e instanceof Error ? e.message : e)
  );

  void extractAndStoreMemories(userId, messageSource, reply, apiKey).catch((e) =>
    console.warn("[memory-system] Background extract failed:", e instanceof Error ? e.message : e)
  );
}

async function handleMemories(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const memories = await listMemoriesForUser(userId);
    json(res, 200, { user_id: userId, count: memories.length, memories });
  } catch (e) {
    console.error("[memories]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("PGRST205") || /does not exist/i.test(msg)) {
      json(res, 503, {
        error:
          "jarvis_memories table not found — run schema/jarvis_memories.sql in Supabase SQL editor",
      });
      return;
    }
    json(res, 500, { error: msg });
  }
}

function parseUserIdFromQuery(_reqUrl, req) {
  return authUserIdFromReq(req) || "";
}

async function handleDeepThinkStatus(req, res) {
  try {
    const userId = parseUserIdFromQuery(req.url, req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const status = await getDeepThinkStatus(userId);
    json(res, 200, status);
  } catch (e) {
    console.error("[deep-think-status]", e);
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleDeepThink(req, res) {
  try {
    const userId = parseUserIdFromQuery(req.url, req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    const t0 = Date.now();
    const result = await runDeepThink(userId);
    console.log(`[deep-think] forced run for ${userId} ms=${Date.now() - t0}`);
    json(res, 200, { user_id: userId, ...result });
  } catch (e) {
    console.error("[deep-think]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/deep_think|column/i.test(msg)) {
      json(res, 503, {
        error:
          "deep_think columns missing — run schema/intelligence_files_deep_think.sql in Supabase",
      });
      return;
    }
    json(res, 500, { error: msg });
  }
}

/**
 * Anthropic error JSON: `{ "type":"error", "error": { "type":"...", "message":"..." } }`
 * or legacy shapes — never assume `error` is a string.
 */
function formatAnthropicClientError(responseText) {
  try {
    const j = JSON.parse(responseText);
    if (j.error && typeof j.error === "object" && j.error.message) {
      return String(j.error.message);
    }
    if (typeof j.error === "string") return j.error;
    if (typeof j.message === "string") return j.message;
  } catch {
    /* not JSON */
  }
  return responseText?.trim() || "Unknown error from Anthropic";
}

/**
 * Returns true when the user message contains keywords that benefit from live web search:
 * current prices, news, economic events, gold data, or real-time market context.
 */
function needsWebSearch(msg) {
  const lower = String(msg || "").toLowerCase();
  return [
    "price", "prices", "gold", "xau", "aud/usd",
    "news", "economic", "economy", "event", "events",
    "fomc", "cpi", "nfp", "gdp", "inflation", "fed",
    "interest rate", "rate hike", "rate cut", "central bank",
    "market", "markets", "forecast", "outlook", "analysis",
    "current", "live", "right now", "today", "this week",
    "announcement", "release", "data", "report",
    "search", "look up", "find out", "what is", "what's",
  ].some((kw) => lower.includes(kw));
}

/** Messages API: assistant text is in `content` blocks; primary path is `content[0].text`. */
function extractAssistantText(data) {
  const blocks = data?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const first = blocks[0];
  if (first?.type === "text" && typeof first.text === "string") {
    return first.text;
  }
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/**
 * POST /api/admin/sync-journal-fields
 * Header: x-admin-sync-secret: <ADMIN_SYNC_SECRET>
 * Body JSON: { "source": "notion"|"csv_text"|"csv_url", "user_id": "...", ... }
 * — notion: optional notion_api_key, notion_data_source_id (else NOTION_* env)
 * — csv_text: csv_text (first row = headers), optional dropdown_map { "Column": ["a","b"] }
 * — csv_url: csv_url (fetch CSV), optional dropdown_map
 */
async function handleAdminSyncJournalFields(req, res) {
  const secret = process.env.ADMIN_SYNC_SECRET?.trim();
  if (!secret) {
    json(res, 503, { error: "ADMIN_SYNC_SECRET not configured" });
    return;
  }
  const hdr = req.headers["x-admin-sync-secret"];
  if (hdr !== secret) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: "Payload too large" });
    return;
  }

  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const source = body.source || "notion";
  const userId = authUserIdFromReq(req);
  const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!userId) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }
  if (!supabaseUrl || !supabaseKey) {
    json(res, 503, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" });
    return;
  }

  const dropdownMap =
    body.dropdown_map && typeof body.dropdown_map === "object" ? body.dropdown_map : undefined;

  try {
    if (source === "notion") {
      const notionApiKey =
        (typeof body.notion_api_key === "string" && body.notion_api_key.trim()) ||
        process.env.NOTION_API_KEY?.trim();
      const dataSourceId =
        (typeof body.notion_data_source_id === "string" && body.notion_data_source_id.trim()) ||
        process.env.NOTION_DATA_SOURCE_ID?.trim();
      const result = await syncJournalFieldsFromNotion({
        userId,
        notionApiKey,
        dataSourceId,
        supabaseUrl,
        supabaseKey,
      });
      json(res, 200, result);
      return;
    }

    if (source === "csv_text") {
      const csvText = typeof body.csv_text === "string" ? body.csv_text : "";
      const result = await syncJournalFieldsFromCsvText({
        userId,
        csvText,
        supabaseUrl,
        supabaseKey,
        dropdownMap,
      });
      json(res, 200, result);
      return;
    }

    if (source === "csv_url") {
      const u = typeof body.csv_url === "string" ? body.csv_url.trim() : "";
      if (!u) {
        json(res, 400, { error: "csv_url required" });
        return;
      }
      const fr = await fetch(u, { cache: "no-store" });
      if (!fr.ok) {
        json(res, 502, { error: `CSV fetch failed (${fr.status})` });
        return;
      }
      const csvText = await fr.text();
      const result = await syncJournalFieldsFromCsvText({
        userId,
        csvText,
        supabaseUrl,
        supabaseKey,
        dropdownMap,
      });
      json(res, 200, result);
      return;
    }

    json(res, 400, { error: "source must be notion, csv_text, or csv_url" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    json(res, 500, { error: msg });
  }
}

async function handleJournalFields(req, res) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const userId = authUserIdFromReq(req);
  if (!userId) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }
  // journal_fields uses user_id TEXT (email for legacy users, UUID for new OAuth users)
  const queryId = legacyEmailForAuthUserId(userId) || userId;
  try {
    const r = await fetch(
      `${url}/rest/v1/journal_fields?user_id=eq.${encodeURIComponent(queryId)}&order=display_order.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    const text = await r.text();
    if (!r.ok) { json(res, r.status, { error: formatSupabaseError(text, r.status) }); return; }
    const fields = JSON.parse(text);
    json(res, 200, { fields: Array.isArray(fields) ? fields : [] });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

function parseJournalPhotoSlotsUserId(req) {
  return authUserIdFromReq(req) || "";
}

function normalizeJournalPhotoSlotRow(row) {
  const slot_id = String(row?.slot_id || "").trim();
  const label = String(row?.label || "").trim();
  if (!slot_id || !label) return null;
  return {
    slot_id,
    label,
    display_order: Number(row?.display_order) || 0,
  };
}

/** GET /api/journal-photo-slots?auth_user_id=eq.{email} */
async function handleJournalPhotoSlotsGet(req, res) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }
  const userId = parseJournalPhotoSlotsUserId(req);
  try {
    const endpoint = `${url}/rest/v1/journal_photo_slots?auth_user_id=eq.${encodeURIComponent(userId)}&select=slot_id,label,display_order&order=display_order.asc`;
    const r = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const text = await r.text();
    if (!r.ok) {
      json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
        error: formatSupabaseError(text, r.status) || `Supabase HTTP ${r.status}`,
      });
      return;
    }
    let rows;
    try {
      rows = JSON.parse(text);
    } catch {
      json(res, 502, { error: "Invalid JSON from Supabase" });
      return;
    }
    const slots = (Array.isArray(rows) ? rows : [])
      .map(normalizeJournalPhotoSlotRow)
      .filter(Boolean)
      .sort((a, b) => a.display_order - b.display_order);
    json(res, 200, { slots });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** PATCH /api/journal-photo-slots — replace all slots for user. Body: { user_id, slots: [{ slot_id, label, display_order }] } */
async function handleJournalPhotoSlotsPatch(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: "Payload too large" });
    return;
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  const userId = authUserIdFromReq(req);
  if (!userId) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  const incoming = Array.isArray(body.slots) ? body.slots : [];
  const slots = incoming
    .map(normalizeJournalPhotoSlotRow)
    .filter(Boolean)
    .map((s, i) => ({ ...s, display_order: Number.isFinite(s.display_order) ? s.display_order : i }));

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    const del = await fetch(
      `${url}/rest/v1/journal_photo_slots?auth_user_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
    );
    if (!del.ok) {
      const t = await del.text();
      json(res, del.status, { error: formatSupabaseError(t, del.status) });
      return;
    }

    if (slots.length) {
      const rows = slots.map((s) => ({
        auth_user_id: userId,
    user_id: legacyEmailForAuthUserId(userId) || userId,
        slot_id: s.slot_id,
        label: s.label,
        display_order: s.display_order,
      }));
      const ins = await fetch(`${url}/rest/v1/journal_photo_slots`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(rows),
      });
      const insText = await ins.text();
      if (!ins.ok) {
        json(res, ins.status, { error: formatSupabaseError(insText, ins.status) });
        return;
      }
      let saved;
      try {
        saved = JSON.parse(insText);
      } catch {
        saved = rows;
      }
      const out = (Array.isArray(saved) ? saved : [])
        .map(normalizeJournalPhotoSlotRow)
        .filter(Boolean)
        .sort((a, b) => a.display_order - b.display_order);
      json(res, 200, { slots: out });
      return;
    }

    json(res, 200, { slots: [] });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Normalise a pair string to uppercase with slash (e.g. "xauusd" → "XAU/USD"). */
function normalizePair(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (s.length === 6 && !s.includes("/")) s = s.slice(0, 3) + "/" + s.slice(3);
  return s;
}

// ─── Instant read helpers (log-trade response only) ──────────────────────────

const _IR_WEEKDAY_FMT = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Adelaide",
  weekday: "long",
});

function _irWeekday(dateStr) {
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : _IR_WEEKDAY_FMT.format(d);
  } catch { return null; }
}

async function _irFetchObservations(authUserId) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return [];
  try {
    const res = await fetch(
      `${url}/rest/v1/intelligence_files?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=report&order=version.desc&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Cache-Control": "no-store" } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    const obs = rows?.[0]?.report?.observations;
    return Array.isArray(obs) ? obs : [];
  } catch { return []; }
}

function _irMatchObs(obs, trade, weekday) {
  const session = (trade.session || "").trim().toLowerCase();
  const pairRaw = (trade.pair || "").replace(/\//g, "").trim().toLowerCase();
  const cd = (trade.custom_data && typeof trade.custom_data === "object") ? trade.custom_data : {};
  const model = (cd.model || cd.Model || cd.setup || cd.Setup || cd["Trading Model"] || cd["Model"] || "").trim().toLowerCase();
  const direction = (cd.direction || cd.Direction || "").trim().toLowerCase();
  const lbl = obs.label.toLowerCase();

  switch (obs.category) {
    case "session":
      return !!session && lbl.startsWith(session);
    case "day":
      return !!weekday && lbl.startsWith(weekday.toLowerCase());
    case "combo":
      return !!session && !!weekday && lbl.includes(session) && lbl.includes(weekday.toLowerCase());
    case "setup":
      return !!model && lbl.includes(model);
    case "pair": {
      const obsLblNorm = lbl.replace(/\//g, "");
      return !!pairRaw && obsLblNorm.includes(pairRaw);
    }
    case "direction":
      return !!direction && lbl.startsWith(direction);
    case "custom_field": {
      const m = obs.label.match(/^"(.+?):\s*(.+?)"/);
      if (!m) return false;
      const obsKey = m[1].toLowerCase();
      const obsVal = m[2].toLowerCase();
      for (const [k, v] of Object.entries(cd)) {
        if (k === "photos" || k === "direction") continue;
        if (k.toLowerCase() === obsKey && String(v).toLowerCase() === obsVal) return true;
      }
      return false;
    }
    default: return false;
  }
}

function _irSubject(obs) {
  switch (obs.category) {
    case "session": { const m = obs.label.match(/^(.+?)\s+session\s+is/i); return m ? m[1] : null; }
    case "day":     { const m = obs.label.match(/^(\w+?)s?\s+(?:are|is)\s+/i); return m ? m[1] : null; }
    case "combo":   { const m = obs.label.match(/^(.+?)\s+is\s+/i); return m ? m[1] : null; }
    case "setup":   { const m = obs.label.match(/^(.+?)\s+setup\s+is\s+/i); return m ? m[1] : null; }
    case "pair":    { const m = obs.label.match(/^(\S+)\s+is\s+/i); return m ? m[1] : null; }
    case "direction": { const m = obs.label.match(/^(\w+)\s+trades\s+/i); return m ? m[1] : null; }
    case "custom_field": { const m = obs.label.match(/^"(.+?)"/); return m ? m[1] : null; }
    default: return null;
  }
}

function _irMessage(obs) {
  const ev = obs.evidence;
  const pct = (r) => r != null ? `${Math.round(r * 100)}%` : "n/a";
  const sub = _irSubject(obs) || "That pattern";
  const green = obs.type === "green";

  if (obs.category === "custom_field") {
    const wr = pct(ev.winRateWith);
    const n = ev.sampleSize;
    return green
      ? `Positive signal — "${sub}" correlates with ${wr} wins across ${n} trades.`
      : `Watch this — "${sub}" is a recurring leak at ${wr} across ${n} trades.`;
  }

  const wr = pct(ev.winRate);
  const n = ev.sampleSize;

  switch (obs.category) {
    case "session":
      return green
        ? `This aligns with your edge — ${sub} is your best session at ${wr} across ${n} decided trades.`
        : `Careful — ${sub} is a weak session at ${wr} across ${n} decided trades.`;
    case "day":
      return green
        ? `${sub}s are a strong day for you — ${wr} across ${n} trades.`
        : `${sub}s are a weak spot — ${wr} across ${n} trades. Stay selective.`;
    case "combo":
      return green
        ? `Edge confirmed — ${sub} is hitting ${wr} across ${n} trades. Good window.`
        : `Heads up — ${sub} is a leak at ${wr} across ${n} trades. Protect capital.`;
    case "pair":
      return green
        ? `${sub} is your edge instrument — ${wr} across ${n} decided trades.`
        : `${sub} is underperforming in your data — ${wr} across ${n} decided. Stay disciplined.`;
    case "direction":
      return green
        ? `${sub} trades are your stronger side — ${wr} across ${n} decided.`
        : `${sub} trades are a leak for you — ${wr} across ${n} decided. Extra discipline required.`;
    case "setup":
      return green
        ? `${sub} is an edge setup — ${wr} across ${n} decided. Lean in.`
        : `${sub} needs review — ${wr} across ${n} decided trades.`;
    default:
      return green
        ? `This aligns with a proven edge — ${wr} across ${n} decided trades.`
        : `This matches a known leak — ${wr} across ${n} decided. Stay sharp.`;
  }
}

// Specificity tier: 0 = specific attribute (pair/setup/custom_field), 1 = broad (session/day/combo/direction)
function _irSpecificity(obs) {
  return ["pair", "setup", "custom_field"].includes(obs.category) ? 0 : 1;
}

async function buildInstantRead(authUserId, tradeRow) {
  try {
    const observations = await _irFetchObservations(authUserId);
    if (!observations.length) return { found: false };
    const weekday = _irWeekday(tradeRow.traded_at);
    // Collect all matches then rank: specificity → red over green → strength.
    const matches = [];
    for (const obs of observations) {
      if (_irMatchObs(obs, tradeRow, weekday)) matches.push(obs);
    }
    if (!matches.length) return { found: false };
    matches.sort((a, b) => {
      const sd = _irSpecificity(a) - _irSpecificity(b);          // lower tier wins
      if (sd !== 0) return sd;
      const rd = (a.type === "red" ? 0 : 1) - (b.type === "red" ? 0 : 1); // red before green
      if (rd !== 0) return rd;
      return (b.strength ?? 0) - (a.strength ?? 0);              // higher strength wins
    });
    const best = matches[0];
    if (!best) return { found: false };
    return {
      found: true,
      type: best.type,
      category: best.category,
      message: _irMessage(best),
      evidence: best.evidence,
      strength: best.strength,
    };
  } catch { return { found: false }; }
}

/** GET /api/journal-trades — manual LOG TRADE rows (journal_trades). */
async function handleJournalTradesGet(req, res) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }
  const authUserId = authUserIdFromReq(req);
  const emailUserId = legacyEmailForAuthUserId(authUserId, req.jarvisAuth?.email) || authUserId || "";

  const fetchByUserId = async (uid) => {
    const endpoint = `${url}/rest/v1/journal_trades?user_id=eq.${encodeURIComponent(uid)}&select=*&order=traded_at.desc`;
    const r = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        Range: `0-${MAX_SUPABASE_ROWS - 1}`,
      },
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, status: r.status, text };
    try { return { ok: true, rows: JSON.parse(text) }; } catch { return { ok: false, status: 502, text: "Invalid JSON" }; }
  };

  try {
    // Primary: query by email (current format).
    const primary = await fetchByUserId(emailUserId);
    if (!primary.ok) {
      json(res, primary.status >= 400 && primary.status < 600 ? primary.status : 502, {
        error: formatSupabaseError(primary.text, primary.status) || `Supabase HTTP ${primary.status}`,
      });
      return;
    }
    let rows = Array.isArray(primary.rows) ? primary.rows : [];

    // Fallback: also fetch rows stored under the raw auth UUID (legacy, before email resolution was fixed).
    if (authUserId && authUserId !== emailUserId) {
      const fallback = await fetchByUserId(authUserId);
      if (fallback.ok && Array.isArray(fallback.rows) && fallback.rows.length > 0) {
        const seenIds = new Set(rows.map((r) => r.id));
        for (const row of fallback.rows) {
          if (!seenIds.has(row.id)) rows.push(row);
        }
        rows.sort((a, b) => new Date(b.traded_at) - new Date(a.traded_at));
      }
    }

    json(res, 200, rows);
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleLogTrade(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { json(res, 413, { error: "Payload too large" }); return; }
  let body;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: "Invalid JSON" }); return; }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }

  const rrVal = body.rr != null && body.rr !== "" ? Number(body.rr) : null;
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }
  const row = {
    user_id: legacyEmailForAuthUserId(authUserId, req.jarvisAuth?.email) || authUserId,
    traded_at: body.traded_at || new Date().toISOString(),
    pair: normalizePair(body.pair) || "XAU/USD",
    outcome: body.outcome || null,
    rr: Number.isFinite(rrVal) ? rrVal : null,
    session: body.session || null,
    account: body.account || null,
    custom_data: body.custom_data && typeof body.custom_data === "object" ? body.custom_data : {},
  };

  try {
    const r = await fetch(`${url}/rest/v1/journal_trades`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    const text = await r.text();
    if (!r.ok) {
      json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
        error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
      });
      return;
    }
    let data;
    try { data = JSON.parse(text); } catch { data = []; }
    const trade = Array.isArray(data) ? data[0] : data;
    const read = await buildInstantRead(authUserId, row);
    json(res, 201, { trade, read });
    // Regenerate brain async — trade is saved, response is sent, don't block.
    // authUserId is the auth_user_id (UUID) that generateIntelligenceFile expects.
    firePostSyncBrain(authUserId);
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidString(id) {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

/** PATCH /api/journal-trades — update one `journal_trades` row (must match id + user_id). */
async function handleJournalTradePatch(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: "Payload too large" });
    return;
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const authUserId = authUserIdFromReq(req);
  const userId = legacyEmailForAuthUserId(authUserId, req.jarvisAuth?.email) || authUserId || "";
  if (!isUuidString(id) || !userId) {
    json(res, 400, { error: "Valid id required" });
    return;
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  const rrVal = body.rr != null && body.rr !== "" ? Number(body.rr) : null;
  const patch = {
    traded_at: body.traded_at || undefined,
    pair: body.pair !== undefined ? (normalizePair(body.pair) || null) : undefined,
    outcome: body.outcome !== undefined ? body.outcome || null : undefined,
    rr: body.rr !== undefined ? (Number.isFinite(rrVal) ? rrVal : null) : undefined,
    session: body.session !== undefined ? body.session || null : undefined,
    account: body.account !== undefined ? body.account || null : undefined,
    custom_data:
      body.custom_data !== undefined && typeof body.custom_data === "object" ? body.custom_data : undefined,
  };
  const payload = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(payload).length) {
    json(res, 400, { error: "No updatable fields" });
    return;
  }

  const patchByUserId = async (uid) => {
    const endpoint = `${url}/rest/v1/journal_trades?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(uid)}`;
    return fetch(endpoint, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });
  };

  try {
    let r = await patchByUserId(userId);
    let text = await r.text();
    if (!r.ok) {
      json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
        error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
      });
      return;
    }
    let data;
    try { data = JSON.parse(text); } catch { data = []; }

    // If no rows matched (row stored under raw UUID from before email fix), retry with UUID.
    if (Array.isArray(data) && data.length === 0 && authUserId && authUserId !== userId) {
      r = await patchByUserId(authUserId);
      text = await r.text();
      if (!r.ok) {
        json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
          error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
        });
        return;
      }
      try { data = JSON.parse(text); } catch { data = []; }
    }

    json(res, 200, { trade: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Parses a date string in various formats. Returns a Date or null. */
function parseFlexibleDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!s) return null;

  // Strip leading weekday prefix: "Monday 14/10/2025" → "14/10/2025"
  s = s.replace(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)[,\s]+/i, "").trim();

  // Month-name formats: "October 14, 2025", "October 14, 2025 11:30 AM (GMT+10:30)"
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const monthNameMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2})[,\s]\s*(\d{4})/);
  if (monthNameMatch) {
    const mIdx = MONTHS.indexOf(monthNameMatch[1].toLowerCase());
    if (mIdx !== -1) {
      const yr = parseInt(monthNameMatch[3]);
      const dy = parseInt(monthNameMatch[2]);
      if (yr >= 1900 && yr <= 2100 && dy >= 1 && dy <= 31) {
        const d = new Date(`${yr}-${String(mIdx + 1).padStart(2, "0")}-${String(dy).padStart(2, "0")}T12:00:00Z`);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }

  // Take only the date portion if a time component is present
  const datePart = s.split(/[T ]/)[0].trim();

  // ISO and other formats native Date handles (YYYY-MM-DD, etc.)
  let d = new Date(`${datePart}T12:00:00Z`);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 1900) return d;

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  let m = datePart.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    const [, a, b, yr] = m;
    // Prefer DD/MM if day-first makes sense
    if (parseInt(a) <= 31 && parseInt(b) <= 12) {
      d = new Date(`${yr}-${b.padStart(2, "0")}-${a.padStart(2, "0")}T12:00:00Z`);
      if (!isNaN(d.getTime())) return d;
    }
    // Fallback: MM/DD
    if (parseInt(a) <= 12 && parseInt(b) <= 31) {
      d = new Date(`${yr}-${a.padStart(2, "0")}-${b.padStart(2, "0")}T12:00:00Z`);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // YYYY/MM/DD or YYYY.MM.DD
  m = datePart.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) {
    const [, yr, mo, dy] = m;
    d = new Date(`${yr}-${mo.padStart(2, "0")}-${dy.padStart(2, "0")}T12:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/** Normalises outcome to lowercase "win", "loss", or "be". Returns null if unrecognised. */
function normalizeOutcomeForImport(raw) {
  if (!raw) return null;
  const o = String(raw).trim().toUpperCase().replace(/[.\-_\s]/g, "");
  if (o === "WIN" || o === "W" || o === "WON") return "win";
  if (o === "LOSS" || o === "L" || o === "LOSE" || o === "LOST") return "loss";
  if (o === "BE" || o === "B" || o === "BREAKEVEN") return "be";
  return null;
}

/** POST /api/csv-import — bulk-inserts CSV-sourced trades into journal_trades. */
async function handleCsvImport(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { json(res, 413, { error: "Payload too large" }); return; }
  let body;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: "Invalid JSON" }); return; }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }

  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId, req.jarvisAuth?.email) || authUserId;

  const incoming = Array.isArray(body.trades) ? body.trades : [];
  if (incoming.length === 0) { json(res, 400, { error: "No trades provided" }); return; }

  const validRows = [];
  const errors = [];

  for (let i = 0; i < incoming.length; i++) {
    const t = incoming[i];
    const rowNum = i + 1;

    const parsedDate = parseFlexibleDate(t.date);
    if (!parsedDate) { errors.push({ row: rowNum, reason: `Invalid date: "${t.date}"` }); continue; }

    const pairRaw = (t.pair || "").trim();
    if (!pairRaw) { errors.push({ row: rowNum, reason: "Missing pair/instrument" }); continue; }

    const outcome = normalizeOutcomeForImport(t.outcome);
    if (!outcome) { errors.push({ row: rowNum, reason: `Invalid outcome: "${t.outcome}"` }); continue; }

    let rr = null;
    if (t.rr != null && t.rr !== "") {
      const rrVal = Number(t.rr);
      if (!Number.isFinite(rrVal)) { errors.push({ row: rowNum, reason: `Invalid RR: "${t.rr}"` }); continue; }
      rr = rrVal;
    }

    validRows.push({
      user_id: userId,
      traded_at: parsedDate.toISOString(),
      pair: normalizePair(pairRaw) || pairRaw.toUpperCase(),
      outcome,
      rr,
      session: (t.session || "").trim() || null,
      account: (t.account || "").trim() || null,
      custom_data: {
        ...(t.custom_data && typeof t.custom_data === "object" && !Array.isArray(t.custom_data) ? t.custom_data : {}),
        direction: (t.direction || "").trim() || null,
        model: (t.model || "").trim() || null,
        notes: (t.notes || "").trim() || null,
        source: "csv_import",
      },
    });
  }

  let imported = 0;
  const BATCH = 100;
  for (let i = 0; i < validRows.length; i += BATCH) {
    const batch = validRows.slice(i, i + BATCH);
    const r = await fetch(`${url}/rest/v1/journal_trades`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!r.ok) {
      const text = await r.text();
      json(res, 502, { error: formatSupabaseError(text, r.status) || `Supabase HTTP ${r.status}` });
      return;
    }
    imported += batch.length;
  }

  json(res, 200, { imported, skipped: errors.length, errors: errors.slice(0, 100) });
}

/** DELETE /api/journal-trades?id={uuid} */
async function handleJournalTradeDelete(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const id = (u.searchParams.get("id") || "").trim();
  const authUserId = authUserIdFromReq(req);
  const userId = legacyEmailForAuthUserId(authUserId, req.jarvisAuth?.email) || authUserId || "";
  if (!isUuidString(id)) {
    json(res, 400, { error: "Valid id query param required" });
    return;
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  const deleteByUserId = async (uid) => {
    const endpoint = `${url}/rest/v1/journal_trades?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(uid)}`;
    return fetch(endpoint, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=representation" },
    });
  };

  try {
    let r = await deleteByUserId(userId);
    let text = await r.text();
    if (!r.ok) {
      json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
        error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
      });
      return;
    }
    let deleted;
    try { deleted = JSON.parse(text); } catch { deleted = []; }

    // If no rows matched (row stored under raw UUID from before email fix), retry with UUID.
    if (Array.isArray(deleted) && deleted.length === 0 && authUserId && authUserId !== userId) {
      r = await deleteByUserId(authUserId);
      text = await r.text();
      if (!r.ok) {
        json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
          error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
        });
        return;
      }
    }

    json(res, 200, { ok: true, deleted: id });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

const TRADE_ROW_PATCH_KEYS = new Set([
  "date",
  "session",
  "outcome",
  "rr",
  "pair",
  "model",
  "notes",
  "direction",
  "notion_extras",
]);

/** PATCH /api/trades-row — update one `trades` row (id + user_id). Notion may re-sync later. */
async function handleTradeRowPatch(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: "Payload too large" });
    return;
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const userId = authUserIdFromReq(req);
  if (!isUuidString(id) || !userId) {
    json(res, 400, { error: "Valid id required" });
    return;
  }

  const { url, key, tableRaw } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }
  const tableEnc = encodeURIComponent(tableRaw);

  const patch = {};
  for (const k of TRADE_ROW_PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, k)) continue;
    const v = body[k];
    if (k === "rr") {
      const n = v != null && v !== "" ? Number(v) : null;
      patch[k] = Number.isFinite(n) ? n : null;
      continue;
    }
    if (k === "date") {
      if (typeof v === "string" && v.trim()) patch[k] = v.trim();
      continue;
    }
    if (k === "notion_extras") {
      if (v != null && typeof v === "object" && !Array.isArray(v)) patch[k] = v;
      continue;
    }
    patch[k] = v == null || v === "" ? "" : String(v);
  }
  if (!Object.keys(patch).length) {
    json(res, 400, { error: "No updatable fields" });
    return;
  }
  patch.updated_at = new Date().toISOString();

  try {
    const endpoint = `${url}/rest/v1/${tableEnc}?id=eq.${encodeURIComponent(id)}&auth_user_id=eq.${encodeURIComponent(userId)}`;
    const r = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });
    const text = await r.text();
    if (!r.ok) {
      json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
        error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
      });
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = [];
    }
    json(res, 200, { trade: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** DELETE /api/trades-row?id={uuid}&auth_user_id=eq.{email} */
async function handleTradeRowDelete(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const id = (u.searchParams.get("id") || "").trim();
  const userId = parseSupabaseUserIdParam(req);
  if (!isUuidString(id)) {
    json(res, 400, { error: "Valid id query param required" });
    return;
  }

  const { url, key, tableRaw } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }
  const tableEnc = encodeURIComponent(tableRaw);

  try {
    const endpoint = `${url}/rest/v1/${tableEnc}?id=eq.${encodeURIComponent(id)}&auth_user_id=eq.${encodeURIComponent(userId)}`;
    const r = await fetch(endpoint, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const text = await r.text();
    if (!r.ok) {
      json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
        error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
      });
      return;
    }
    json(res, 200, { ok: true, deleted: id });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * GET /api/economic-calendar
 *
 * Returns economic release rows for the **calendar day in Australia/Adelaide**
 * (same timezone anchor as trade dates elsewhere in Jarvis).
 *
 * Data source: public JSON that mirrors Forex Factory–style fields (title, country, date, impact).
 * This is a **third-party** weekly feed — not an official Forex Factory API; the URL or schema
 * can change without notice. For production-grade stability, extend this handler to call a paid
 * calendar API when `FMP_API_KEY` or `ECONOMIC_CALENDAR_API_KEY` is set (e.g. Financial Modeling Prep).
 */
const JARVIS_ECONOMIC_TZ = "Australia/Adelaide";
const FF_STYLE_CALENDAR_JSON_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

function formatAdelaideDateKey(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JARVIS_ECONOMIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const mo = parts.find((p) => p.type === "month")?.value;
  const da = parts.find((p) => p.type === "day")?.value;
  if (!y || !mo || !da) return "";
  return `${y}-${mo}-${da}`;
}

function mapEconomicImpact(raw) {
  const u = String(raw || "").trim().toLowerCase();
  if (u === "high") return "high";
  if (u === "medium") return "medium";
  if (u === "holiday") return "holiday";
  return "low";
}

async function handleEconomicCalendar(req, res) {
  const todayKey = formatAdelaideDateKey(new Date());
  const base = {
    date: todayKey,
    timezone: JARVIS_ECONOMIC_TZ,
    source: "ff_style_feed",
    items: [],
  };
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 12000);
    let r;
    try {
      r = await fetch(FF_STYLE_CALENDAR_JSON_URL, {
        signal: ac.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "OperationJarvis/1.0 (private)",
        },
      });
    } finally {
      clearTimeout(tid);
    }
    if (!r.ok) {
      json(res, 200, {
        ...base,
        error: `Calendar upstream HTTP ${r.status}`,
      });
      return;
    }
    const body = await r.text();
    let arr;
    try {
      arr = JSON.parse(body);
    } catch {
      json(res, 200, {
        ...base,
        error: "Calendar upstream returned invalid JSON",
      });
      return;
    }
    if (!Array.isArray(arr)) {
      json(res, 200, {
        ...base,
        error: "Calendar upstream returned non-array",
      });
      return;
    }
    const rows = [];
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const iso = row.date;
      if (typeof iso !== "string" || !iso.trim()) continue;
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) continue;
      if (formatAdelaideDateKey(new Date(ms)) !== todayKey) continue;
      const title = String(row.title || "").trim();
      if (!title) continue;
      const timeLabel = new Intl.DateTimeFormat("en-AU", {
        timeZone: JARVIS_ECONOMIC_TZ,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(ms));
      rows.push({
        _ms: ms,
        time: timeLabel,
        currency: String(row.country || "").trim() || "—",
        title,
        impact: mapEconomicImpact(row.impact),
      });
    }
    rows.sort((a, b) => a._ms - b._ms);
    const items = rows.map(({ _ms, ...rest }) => rest);
    json(res, 200, {
      ...base,
      upstream: FF_STYLE_CALENDAR_JSON_URL,
      items,
    });
  } catch (e) {
    json(res, 200, {
      ...base,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function parseSupabaseUserIdParam(req) {
  return authUserIdFromReq(req) || "";
}

/** GET /api/accounts — list non-archived accounts with recent equity log + payout totals */
async function handleTradingAccountsGet(req, res) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  const u2 = new URL(req.url, "http://localhost");
  const includeArchived = u2.searchParams.get("include_archived") === "true";
  try {
    const r = await fetch(
      `${url}/rest/v1/trading_accounts?user_id=eq.${encodeURIComponent(userId)}${includeArchived ? "" : "&status=neq.archived"}&order=created_at.desc&select=*`,
      { headers: hdrs }
    );
    const text = await r.text();
    if (!r.ok) { json(res, r.status, { error: formatSupabaseError(text, r.status) }); return; }
    let accounts = JSON.parse(text);
    if (!Array.isArray(accounts)) accounts = [];

    if (accounts.length) {
      const idParam = `(${accounts.map((a) => a.id).join(",")})`;
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [eqRes, pyRes] = await Promise.all([
        fetch(`${url}/rest/v1/equity_log_entries?user_id=eq.${encodeURIComponent(userId)}&account_id=in.${idParam}&logged_at=gte.${cutoff}&order=logged_at.asc`, { headers: hdrs }),
        fetch(`${url}/rest/v1/payouts?user_id=eq.${encodeURIComponent(userId)}&account_id=in.${idParam}&select=account_id,amount,net_amount,paid_at&order=paid_at.desc`, { headers: hdrs }),
      ]);
      let equityEntries = [];
      if (eqRes.ok) { try { equityEntries = JSON.parse(await eqRes.text()); } catch {} }
      if (!Array.isArray(equityEntries)) equityEntries = [];
      let payoutRows = [];
      if (pyRes.ok) { try { payoutRows = JSON.parse(await pyRes.text()); } catch {} }
      if (!Array.isArray(payoutRows)) payoutRows = [];

      const eqByAcc = new Map();
      for (const e of equityEntries) {
        if (!eqByAcc.has(e.account_id)) eqByAcc.set(e.account_id, []);
        eqByAcc.get(e.account_id).push(e);
      }
      const pyTotalByAcc = new Map();
      const pyNetByAcc = new Map();
      const pyLastByAcc = new Map();
      for (const p of payoutRows) {
        pyTotalByAcc.set(p.account_id, (pyTotalByAcc.get(p.account_id) || 0) + Number(p.amount));
        pyNetByAcc.set(p.account_id, (pyNetByAcc.get(p.account_id) || 0) + Number(p.net_amount != null ? p.net_amount : p.amount));
        if (!pyLastByAcc.has(p.account_id)) pyLastByAcc.set(p.account_id, p.paid_at);
      }
      for (const acc of accounts) {
        acc.equity_log = eqByAcc.get(acc.id) || [];
        acc.total_payouts = pyTotalByAcc.get(acc.id) || 0;
        acc.total_net_payouts = pyNetByAcc.get(acc.id) || 0;
        acc.last_payout_at = pyLastByAcc.get(acc.id) || null;
      }
    }
    json(res, 200, { accounts });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** GET /api/accounts/:id — single account with full equity log + all payouts */
async function handleTradingAccountsGetSingle(req, res) {
  const pathname = req.url.split("?")[0];
  const m = pathname.match(/^\/api\/accounts\/([^/]+)\/?$/);
  if (!m) { json(res, 400, { error: "Invalid path" }); return; }
  const id = m[1];
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const r = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
      { headers: hdrs }
    );
    const text = await r.text();
    if (!r.ok) { json(res, r.status, { error: formatSupabaseError(text, r.status) }); return; }
    const arr = JSON.parse(text);
    if (!Array.isArray(arr) || !arr.length) { json(res, 404, { error: "Account not found" }); return; }
    const account = arr[0];
    const [eqRes, pyRes] = await Promise.all([
      fetch(`${url}/rest/v1/equity_log_entries?account_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&order=logged_at.asc`, { headers: hdrs }),
      fetch(`${url}/rest/v1/payouts?account_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&order=paid_at.desc`, { headers: hdrs }),
    ]);
    let equity_log = [];
    if (eqRes.ok) { try { equity_log = JSON.parse(await eqRes.text()); } catch {} }
    if (!Array.isArray(equity_log)) equity_log = [];
    let payouts = [];
    if (pyRes.ok) { try { payouts = JSON.parse(await pyRes.text()); } catch {} }
    if (!Array.isArray(payouts)) payouts = [];
    account.equity_log = equity_log;
    account.payouts = payouts;
    account.total_payouts = payouts.reduce((s, p) => s + Number(p.amount), 0);
    json(res, 200, { account });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/accounts */
async function handleTradingAccountsPost(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { json(res, 413, { error: "Payload too large" }); return; }
  let body;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;

  const name = String(body.name || "Account").trim().slice(0, 200);
  const type = String(body.type || "eval").toLowerCase();
  if (!["eval", "funded", "live"].includes(type)) { json(res, 400, { error: "type must be eval, funded, or live" }); return; }
  const starting_balance = Number(body.starting_balance);
  if (!Number.isFinite(starting_balance) || starting_balance < 0) { json(res, 400, { error: "starting_balance must be a non-negative number" }); return; }

  const row = {
    user_id: userId,
    name,
    type,
    firm_name: body.firm_name ? String(body.firm_name).trim().slice(0, 200) : null,
    broker_name: body.broker_name ? String(body.broker_name).trim().slice(0, 200) : null,
    starting_balance,
    current_equity: starting_balance,
    profit_target: body.profit_target != null && body.profit_target !== "" ? Number(body.profit_target) || null : null,
    daily_loss_cap: body.daily_loss_cap != null && body.daily_loss_cap !== "" ? Number(body.daily_loss_cap) || null : null,
    max_drawdown: body.max_drawdown != null && body.max_drawdown !== "" ? Number(body.max_drawdown) || null : null,
    default_risk_pct: body.default_risk_pct != null && body.default_risk_pct !== "" ? Number(body.default_risk_pct) : 1,
    default_pair: body.default_pair ? String(body.default_pair).trim().slice(0, 20) : null,
    profit_split_pct: body.profit_split_pct != null && body.profit_split_pct !== "" ? Number(body.profit_split_pct) || null : (type === "funded" ? 80 : null),
    payout_frequency: body.payout_frequency ? String(body.payout_frequency).trim() : null,
    minimum_trading_days: body.minimum_trading_days != null && body.minimum_trading_days !== "" ? (Math.round(Number(body.minimum_trading_days)) || null) : null,
    personal_monthly_target: body.personal_monthly_target != null && body.personal_monthly_target !== "" ? Number(body.personal_monthly_target) || null : null,
    status: "active",
  };

  const postHdrs = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
  try {
    const r = await fetch(`${url}/rest/v1/trading_accounts`, { method: "POST", headers: postHdrs, body: JSON.stringify(row) });
    const text = await r.text();
    if (!r.ok) { json(res, r.status >= 400 && r.status < 600 ? r.status : 502, { error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}` }); return; }
    const data = JSON.parse(text);
    const acc = Array.isArray(data) ? data[0] : data;
    if (acc && acc.id) {
      fetch(`${url}/rest/v1/equity_log_entries`, {
        method: "POST",
        headers: postHdrs,
        body: JSON.stringify({ account_id: acc.id, user_id: userId, equity: starting_balance, note: "Initial balance" }),
      }).catch(() => {});
    }
    acc.equity_log = [];
    acc.total_payouts = 0;
    acc.last_payout_at = null;
    json(res, 201, { account: acc });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** PATCH /api/accounts/:id */
async function handleTradingAccountsPatch(req, res) {
  const pathname = req.url.split("?")[0];
  const m = pathname.match(/^\/api\/accounts\/([^/]+)\/?$/);
  if (!m) { json(res, 400, { error: "Invalid path" }); return; }
  const id = m[1];
  let raw;
  try { raw = await readBody(req); } catch { json(res, 413, { error: "Payload too large" }); return; }
  let body;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const check = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: hdrs }
    );
    if (!check.ok) { json(res, check.status, { error: "Ownership check failed" }); return; }
    const found = JSON.parse(await check.text());
    if (!Array.isArray(found) || !found.length) { json(res, 404, { error: "Account not found" }); return; }

    const patch = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = String(body.name).trim().slice(0, 200);
    if (body.type != null) {
      const t = String(body.type).toLowerCase();
      if (!["eval", "funded", "live"].includes(t)) { json(res, 400, { error: "type must be eval, funded, or live" }); return; }
      patch.type = t;
    }
    if (body.firm_name !== undefined) patch.firm_name = body.firm_name ? String(body.firm_name).trim().slice(0, 200) : null;
    if (body.starting_balance !== undefined) {
      const v = Number(body.starting_balance);
      if (!Number.isFinite(v)) { json(res, 400, { error: "starting_balance must be a number" }); return; }
      patch.starting_balance = v;
    }
    if (body.profit_target !== undefined) patch.profit_target = body.profit_target != null && body.profit_target !== "" ? Number(body.profit_target) : null;
    if (body.daily_loss_cap !== undefined) patch.daily_loss_cap = body.daily_loss_cap != null && body.daily_loss_cap !== "" ? Number(body.daily_loss_cap) : null;
    if (body.max_drawdown !== undefined) patch.max_drawdown = body.max_drawdown != null && body.max_drawdown !== "" ? Number(body.max_drawdown) : null;
    if (body.default_risk_pct !== undefined) patch.default_risk_pct = body.default_risk_pct != null && body.default_risk_pct !== "" ? Number(body.default_risk_pct) : null;
    if (body.default_pair !== undefined) patch.default_pair = body.default_pair ? String(body.default_pair).trim().slice(0, 20) : null;
    if (body.broker_name !== undefined) patch.broker_name = body.broker_name ? String(body.broker_name).trim().slice(0, 200) : null;
    if (body.profit_split_pct !== undefined) patch.profit_split_pct = body.profit_split_pct != null && body.profit_split_pct !== "" ? Number(body.profit_split_pct) : null;
    if (body.payout_frequency !== undefined) patch.payout_frequency = body.payout_frequency ? String(body.payout_frequency).trim() : null;
    if (body.minimum_trading_days !== undefined) patch.minimum_trading_days = body.minimum_trading_days != null && body.minimum_trading_days !== "" ? (Math.round(Number(body.minimum_trading_days)) || null) : null;
    if (body.personal_monthly_target !== undefined) patch.personal_monthly_target = body.personal_monthly_target != null && body.personal_monthly_target !== "" ? Number(body.personal_monthly_target) : null;

    if (Object.keys(patch).length <= 1) { json(res, 400, { error: "No updatable fields" }); return; }

    const r = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "PATCH", headers: { ...hdrs, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(patch) }
    );
    const text = await r.text();
    if (!r.ok) { json(res, r.status >= 400 && r.status < 600 ? r.status : 502, { error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}` }); return; }
    const data = JSON.parse(text);
    json(res, 200, { account: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** GET /api/account-snapshots?user_id=...&account_id=...&limit= */
async function handleAccountSnapshotsGet(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const userId = parseSupabaseUserIdParam(req);

  const accountId = (u.searchParams.get("account_id") || "").trim();
  if (!accountId) {
    json(res, 400, { error: "account_id required" });
    return;
  }
  let limit = Number(u.searchParams.get("limit") || 120);
  if (!Number.isFinite(limit) || limit < 1) limit = 120;
  limit = Math.min(500, Math.floor(limit));

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  try {
    const verify = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(accountId)}&auth_user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    const vText = await verify.text();
    if (!verify.ok) {
      json(res, verify.status, { error: formatSupabaseError(vText, verify.status) });
      return;
    }
    const v = JSON.parse(vText);
    if (!Array.isArray(v) || v.length === 0) {
      json(res, 404, { error: "Account not found" });
      return;
    }

    const r = await fetch(
      `${url}/rest/v1/account_equity_snapshots?auth_user_id=eq.${encodeURIComponent(userId)}&account_id=eq.${encodeURIComponent(accountId)}&order=recorded_at.desc&limit=${limit}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    const text = await r.text();
    if (!r.ok) {
      json(res, r.status, { error: formatSupabaseError(text, r.status) });
      return;
    }
    let snaps = JSON.parse(text);
    if (!Array.isArray(snaps)) snaps = [];
    json(res, 200, { snapshots: snaps });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/account-snapshots */
async function handleAccountSnapshotsPost(req, res) {
  let raw;
  try {
    raw = await readBody(req);
  } catch {
    json(res, 413, { error: "Payload too large" });
    return;
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const userId = authUserIdFromReq(req);
  const accountId = String(body.account_id || "").trim();
  const equity = Number(body.equity);

  if (!userId) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }
  if (!accountId) {
    json(res, 400, { error: "account_id required" });
    return;
  }
  if (!Number.isFinite(equity)) {
    json(res, 400, { error: "equity must be a number" });
    return;
  }

  const note =
    body.note != null && body.note !== "" ? String(body.note).trim().slice(0, 500) : null;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  try {
    const verify = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(accountId)}&auth_user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    const vText = await verify.text();
    if (!verify.ok) {
      json(res, verify.status, { error: formatSupabaseError(vText, verify.status) });
      return;
    }
    const v = JSON.parse(vText);
    if (!Array.isArray(v) || v.length === 0) {
      json(res, 404, { error: "Account not found" });
      return;
    }

    const row = {
      auth_user_id: userId,
    user_id: legacyEmailForAuthUserId(userId) || userId,
      account_id: accountId,
      equity,
      note,
    };
    if (body.recorded_at) {
      const t = new Date(String(body.recorded_at));
      if (!isNaN(t.getTime())) row.recorded_at = t.toISOString();
    }

    const r = await fetch(`${url}/rest/v1/account_equity_snapshots`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    const text = await r.text();
    if (!r.ok) {
      json(res, r.status >= 400 && r.status < 600 ? r.status : 502, {
        error: formatSupabaseError(text, r.status) || `Supabase error ${r.status}`,
      });
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = [];
    }
    json(res, 201, { snapshot: Array.isArray(data) ? data[0] : data });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/accounts/:id/archive */
async function handleAccountsArchive(req, res) {
  const pathname = req.url.split("?")[0];
  const m = pathname.match(/^\/api\/accounts\/([^/]+)\/archive\/?$/);
  if (!m) { json(res, 400, { error: "Invalid path" }); return; }
  const id = m[1];
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const check = await fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`, { headers: hdrs });
    if (!check.ok) { json(res, 502, { error: "Check failed" }); return; }
    const found = JSON.parse(await check.text());
    if (!Array.isArray(found) || !found.length) { json(res, 404, { error: "Account not found" }); return; }
    await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "PATCH", headers: { ...hdrs, "Content-Type": "application/json" }, body: JSON.stringify({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }) }
    );
    json(res, 200, { ok: true });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/accounts/:id/restore — restore an archived account */
async function handleAccountsRestore(req, res) {
  const pathname = req.url.split("?")[0];
  const m = pathname.match(/^\/api\/accounts\/([^/]+)\/restore\/?$/);
  if (!m) { json(res, 400, { error: "Invalid path" }); return; }
  const id = m[1];
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const check = await fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`, { headers: hdrs });
    if (!check.ok) { json(res, 502, { error: "Check failed" }); return; }
    const found = JSON.parse(await check.text());
    if (!Array.isArray(found) || !found.length) { json(res, 404, { error: "Account not found" }); return; }
    await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "PATCH", headers: { ...hdrs, "Content-Type": "application/json" }, body: JSON.stringify({ status: "active", archived_at: null, updated_at: new Date().toISOString() }) }
    );
    json(res, 200, { ok: true });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/accounts/:id/mark-passed — eval accounts only */
async function handleAccountsMarkPassed(req, res) {
  const pathname = req.url.split("?")[0];
  const m = pathname.match(/^\/api\/accounts\/([^/]+)\/mark-passed\/?$/);
  if (!m) { json(res, 400, { error: "Invalid path" }); return; }
  const id = m[1];
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const check = await fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id,type`, { headers: hdrs });
    if (!check.ok) { json(res, 502, { error: "Check failed" }); return; }
    const found = JSON.parse(await check.text());
    if (!Array.isArray(found) || !found.length) { json(res, 404, { error: "Account not found" }); return; }
    if (found[0].type !== "eval") { json(res, 400, { error: "Only eval accounts can be marked passed" }); return; }
    await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "PATCH", headers: { ...hdrs, "Content-Type": "application/json" }, body: JSON.stringify({ status: "passed", updated_at: new Date().toISOString() }) }
    );
    json(res, 200, { ok: true });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/accounts/:id/mark-blown */
async function handleAccountsMarkBlown(req, res) {
  const pathname = req.url.split("?")[0];
  const m = pathname.match(/^\/api\/accounts\/([^/]+)\/mark-blown\/?$/);
  if (!m) { json(res, 400, { error: "Invalid path" }); return; }
  const id = m[1];
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const check = await fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`, { headers: hdrs });
    if (!check.ok) { json(res, 502, { error: "Check failed" }); return; }
    const found = JSON.parse(await check.text());
    if (!Array.isArray(found) || !found.length) { json(res, 404, { error: "Account not found" }); return; }
    await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: "PATCH", headers: { ...hdrs, "Content-Type": "application/json" }, body: JSON.stringify({ status: "blown", updated_at: new Date().toISOString() }) }
    );
    json(res, 200, { ok: true });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/equity-log */
async function handleEquityLog(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { json(res, 413, { error: "Payload too large" }); return; }
  let body;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const account_id = String(body.account_id || "").trim();
  const equity = Number(body.equity);
  if (!account_id) { json(res, 400, { error: "account_id required" }); return; }
  if (!Number.isFinite(equity)) { json(res, 400, { error: "equity must be a number" }); return; }
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  const postHdrs = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
  try {
    const check = await fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(account_id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`, { headers: hdrs });
    if (!check.ok) { json(res, 502, { error: "Ownership check failed" }); return; }
    const found = JSON.parse(await check.text());
    if (!Array.isArray(found) || !found.length) { json(res, 404, { error: "Account not found" }); return; }

    const [r1] = await Promise.all([
      fetch(`${url}/rest/v1/equity_log_entries`, {
        method: "POST",
        headers: postHdrs,
        body: JSON.stringify({ account_id, user_id: userId, equity, note: body.note ? String(body.note).trim().slice(0, 500) : null }),
      }),
      fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(account_id)}&user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: postHdrs,
        body: JSON.stringify({ current_equity: equity, updated_at: new Date().toISOString() }),
      }),
    ]);
    const text = await r1.text();
    const entry = r1.ok ? JSON.parse(text) : null;
    json(res, 201, { entry: Array.isArray(entry) ? entry[0] : entry });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/payouts */
async function handlePayouts(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { json(res, 413, { error: "Payload too large" }); return; }
  let body;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const account_id = String(body.account_id || "").trim();
  if (!account_id) { json(res, 400, { error: "account_id required" }); return; }

  // Funded payouts carry gross_amount + split_pct; simple withdrawals use amount only.
  const isFundedPayout = body.gross_amount != null;
  let amount, gross_amount, split_pct, net_amount;
  if (isFundedPayout) {
    gross_amount = Number(body.gross_amount);
    split_pct = Number(body.split_pct);
    if (!Number.isFinite(gross_amount) || gross_amount <= 0) { json(res, 400, { error: "gross_amount must be a positive number" }); return; }
    if (!Number.isFinite(split_pct) || split_pct <= 0 || split_pct > 100) { json(res, 400, { error: "split_pct must be between 1 and 100" }); return; }
    net_amount = Math.round(gross_amount * split_pct) / 100;
    amount = gross_amount;
  } else {
    amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) { json(res, 400, { error: "amount must be a positive number" }); return; }
    gross_amount = null; split_pct = null; net_amount = null;
  }

  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  const postHdrs = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
  try {
    const accRes = await fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(account_id)}&user_id=eq.${encodeURIComponent(userId)}&select=id,current_equity`, { headers: hdrs });
    if (!accRes.ok) { json(res, 502, { error: "Account fetch failed" }); return; }
    const accs = JSON.parse(await accRes.text());
    if (!Array.isArray(accs) || !accs.length) { json(res, 404, { error: "Account not found" }); return; }
    const newEquity = Number(accs[0].current_equity) - amount;
    const note = body.note ? String(body.note).trim().slice(0, 500) : null;
    const payoutRow = { account_id, user_id: userId, amount, note };
    if (gross_amount !== null) { payoutRow.gross_amount = gross_amount; payoutRow.split_pct = split_pct; payoutRow.net_amount = net_amount; }
    const [r1] = await Promise.all([
      fetch(`${url}/rest/v1/payouts`, { method: "POST", headers: postHdrs, body: JSON.stringify(payoutRow) }),
      fetch(`${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(account_id)}&user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH", headers: postHdrs, body: JSON.stringify({ current_equity: newEquity, updated_at: new Date().toISOString() }),
      }),
    ]);
    const text = await r1.text();
    const payout = r1.ok ? JSON.parse(text) : null;
    json(res, 201, { payout: Array.isArray(payout) ? payout[0] : payout });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** GET /api/capital-overview */
async function handleCapitalOverview(req, res) {
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const userId = legacyEmailForAuthUserId(authUserId) || authUserId;
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  try {
    const [accRes, pyRes] = await Promise.all([
      fetch(`${url}/rest/v1/trading_accounts?user_id=eq.${encodeURIComponent(userId)}&select=id,type,status,starting_balance,current_equity,updated_at`, { headers: hdrs }),
      fetch(`${url}/rest/v1/payouts?user_id=eq.${encodeURIComponent(userId)}&select=amount,net_amount`, { headers: hdrs }),
    ]);
    let accounts = [];
    if (accRes.ok) { try { accounts = JSON.parse(await accRes.text()); } catch {} }
    if (!Array.isArray(accounts)) accounts = [];
    let payouts = [];
    if (pyRes.ok) { try { payouts = JSON.parse(await pyRes.text()); } catch {} }
    if (!Array.isArray(payouts)) payouts = [];

    const active = accounts.filter((a) => a.status === "active");
    const activeFunded = active.filter((a) => a.type === "funded");
    const activeEval = active.filter((a) => a.type === "eval");
    const activeLive = active.filter((a) => a.type === "live");
    const funded_capital = activeFunded.reduce((s, a) => s + Number(a.starting_balance || 0), 0);
    const funded_equity = activeFunded.reduce((s, a) => s + Number(a.current_equity || 0), 0);
    const eval_capital = activeEval.reduce((s, a) => s + Number(a.starting_balance || 0), 0);
    const live_capital = activeLive.reduce((s, a) => s + Number(a.starting_balance || 0), 0);
    const lifetime_payouts = payouts.reduce((s, p) => s + Number(p.net_amount != null ? p.net_amount : p.amount || 0), 0);
    const active_accounts_count = active.length;

    const nonActiveEvals = accounts.filter((a) => a.type === "eval" && a.status !== "active");
    const passedEvals = nonActiveEvals.filter((a) => a.status === "passed").length;
    const eval_pass_rate = nonActiveEvals.length > 0 ? Math.round((passedEvals / nonActiveEvals.length) * 100) : null;

    const blownAccounts = accounts.filter((a) => a.status === "blown");
    let days_since_last_blown = null;
    if (blownAccounts.length) {
      blownAccounts.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      days_since_last_blown = Math.floor((Date.now() - new Date(blownAccounts[0].updated_at).getTime()) / 86400000);
    }

    json(res, 200, { funded_capital, funded_equity, eval_capital, live_capital, lifetime_payouts, active_accounts_count, eval_pass_rate, days_since_last_blown });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** Extract file URLs from Notion page properties (files-type columns). */
function extractFilesFromNotionProps(props) {
  const urls = [];
  if (!props || typeof props !== "object") return urls;
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (!prop || prop.type !== "files" || !Array.isArray(prop.files)) continue;
    for (const f of prop.files) {
      const u =
        f.type === "external" && f.external?.url
          ? String(f.external.url).trim()
          : f.type === "file" && f.file?.url
            ? String(f.file.url).trim()
            : null;
      if (u && /^https?:\/\//i.test(u)) urls.push(u);
    }
  }
  return urls;
}

/**
 * Returns fresh image URLs for one Notion page without running a full sync.
 * Called by the client when an S3 presigned URL has expired (onerror).
 * GET /api/refresh-trade-image?notion_id=xxx&user_id=xxx
 */
async function handleRefreshTradeImage(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const notionId = (u.searchParams.get("notion_id") || "").trim();
  const userId = authUserIdFromReq(req);

  if (!notionId) { json(res, 400, { error: "Missing notion_id" }); return; }
  if (!userId) { json(res, 401, { error: "Unauthorized" }); return; }

  const conn = await loadNotionOAuthConnection(userId);
  let notionKey;
  if (conn.ok) {
    notionKey = conn.accessToken;
  } else {
    // Fallback: env-var Notion key for env-synced trades (no OAuth connection needed).
    const emailUserId = legacyEmailForAuthUserId(userId, null);
    if (emailUserId === "aidenpasque11@gmail.com") {
      notionKey = process.env.NOTION_API_KEY || null;
    } else if (emailUserId === "spasque70@gmail.com") {
      notionKey = process.env.NOTION_API_KEY_MUM || null;
    }
    if (!notionKey) {
      json(res, 503, {
        error:
          conn.reason === "no_mapping"
            ? "Notion mapping missing — complete /notion-setup.html"
            : "Notion not connected — connect at /notion-setup.html",
      });
      return;
    }
  }

  try {
    const pageRes = await fetch(`https://api.notion.com/v1/pages/${notionId}`, {
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": "2025-09-03",
        Accept: "application/json",
      },
    });
    if (!pageRes.ok) {
      json(res, 502, { error: `Notion API ${pageRes.status}` });
      return;
    }
    const page = await pageRes.json();
    const propUrls = extractFilesFromNotionProps(page.properties || {});
    const images = propUrls.map((url) => ({ url, label: "" }));

    if (!images.length) {
      const blockItems = await fetchTradeImagesFromNotionPageBlocks(notionKey, notionId, { maxItems: 20 });
      blockItems.forEach((item) => images.push(item));
    }

    json(res, 200, { images });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

const MAX_PROXY_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * Same-origin fetch of Notion/S3 chart URLs so <img> works without browser referrer quirks.
 * GET /api/proxy-image?u=https%3A%2F%2F...
 */
async function handleImageProxy(req, res) {
  let rawUrl = "";
  try {
    const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    rawUrl = u.searchParams.get("u") || u.searchParams.get("url") || "";
  } catch {
    json(res, 400, { error: "Bad request" });
    return;
  }
  if (!rawUrl.trim()) {
    json(res, 400, { error: "Missing u query parameter" });
    return;
  }

  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    json(res, 400, { error: "Invalid URL" });
    return;
  }

  if (target.protocol !== "https:") {
    json(res, 400, { error: "HTTPS only" });
    return;
  }

  const host = target.hostname.toLowerCase();
  const allowed =
    host.endsWith(".amazonaws.com") ||
    host.endsWith(".notion.so") ||
    host.endsWith(".notion.site") ||
    host.endsWith(".supabase.co");
  if (!allowed) {
    json(res, 403, { error: "Host not allowed" });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const upstream = await fetch(target.href, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { Accept: "image/*,*/*" },
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      json(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        error: "Image fetch failed",
      });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_PROXY_IMAGE_BYTES) {
      json(res, 413, { error: "Image too large" });
      return;
    }

    let ct = upstream.headers.get("content-type") || "";
    ct = ct.split(";")[0].trim().toLowerCase();
    const pathQs = target.pathname + target.search;
    const sniffed =
      buf[0] === 0xff && buf[1] === 0xd8
        ? "image/jpeg"
        : buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
          ? "image/png"
          : buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46
            ? "image/gif"
            : buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
              ? "image/webp"
              : null;
    const looksLikeImage =
      /^image\//i.test(ct) ||
      /\.(png|jpe?g|gif|webp)(\?|$)/i.test(pathQs) ||
      (ct === "application/octet-stream" && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(pathQs));

    if (!sniffed && !looksLikeImage && !/^image\//i.test(ct)) {
      json(res, 415, { error: "Not an image" });
      return;
    }

    let outType = sniffed || (/^image\//i.test(ct) ? ct : null);
    if (!outType) outType = "image/png";

    res.writeHead(200, {
      "Content-Type": outType,
      "Cache-Control": "private, max-age=120",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buf);
  } catch (e) {
    clearTimeout(timer);
    json(res, 502, { error: e instanceof Error ? e.message : "Fetch failed" });
  }
}

async function handleInitProfiles(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    json(res, 401, { error: "ANTHROPIC_API_KEY not set" });
    return;
  }

  const users = OAUTH_BOOT_AUTH_USER_IDS;
  const results = {};

  for (const userId of users) {
    try {
      console.log(`[init-profiles] Generating initial profile for ${userId}…`);
      const profile = await initializeUserProfile(userId, apiKey);
      results[userId] = { success: true, profile };
      console.log(`[init-profiles] Done: ${userId}`);
    } catch (e) {
      results[userId] = { success: false, error: e instanceof Error ? e.message : String(e) };
      console.warn(`[init-profiles] Failed for ${userId}:`, e instanceof Error ? e.message : e);
    }
  }

  json(res, 200, { results });
}

// ── Dev impersonation ────────────────────────────────────────────────────────

function checkDevSecret(req, res) {
  const secret = process.env.DEV_SECRET?.trim();
  if (!secret) { json(res, 503, { error: "DEV_SECRET not configured" }); return false; }
  if (req.headers["x-dev-secret"] !== secret) { json(res, 401, { error: "Unauthorized" }); return false; }
  return true;
}

async function handleAdminUsers(req, res) {
  if (!checkDevSecret(req, res)) return;
  const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const r = await fetch(`${url}/auth/v1/admin/users?per_page=50`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) { json(res, 500, { error: "Failed to fetch users" }); return; }
  const data = await r.json();
  const users = (data.users || []).map((u) => ({
    id: u.id,
    email: u.email,
    last_sign_in_at: u.last_sign_in_at,
    created_at: u.created_at,
  }));
  json(res, 200, { users });
}

async function handleAdminDevLogin(req, res) {
  if (!checkDevSecret(req, res)) return;
  const qp = new URL(req.url, "http://x").searchParams;
  const email = qp.get("email") || "";
  const redirectTo = qp.get("redirect_to") || "";
  if (!email) { json(res, 400, { error: "email required" }); return; }
  const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const body = { type: "magiclink", email };
  if (redirectTo) body.redirect_to = redirectTo;
  const r = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) { json(res, 500, { error: data.message || "Failed to generate link" }); return; }
  const actionLink = data.action_link || data.properties?.action_link || "";
  if (!actionLink) { json(res, 500, { error: "No action_link in Supabase response" }); return; }
  json(res, 200, { action_link: actionLink });
}

async function requestListener(req, res) {
  if (req.method === "OPTIONS") {
    send(res, 204, "", {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return;
  }

  const pathOnly = req.url.split("?")[0];
  if (pathOnly.startsWith("/api/") && !isPublicApiPath(pathOnly)) {
    const auth = await verifyRequestAuth(req);
    if (!auth) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }
    req.jarvisAuth = auth;
  }

  if (!process.env.VERCEL && req.method === "GET" && req.url.split("?")[0] === "/__livereload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(": ok\n\n");
    liveReloadClients.add(res);
    req.on("close", () => {
      liveReloadClients.delete(res);
    });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/briefing")) {
    await handleBriefing(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/chat")) {
    await handleChat(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/refresh-trade-image")) {
    await handleRefreshTradeImage(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/proxy-image")) {
    await handleImageProxy(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/analysis-engine")) {
    await handleAnalysisEngine(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/intelligence-file")) {
    await handleIntelligenceFile(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/memories")) {
    await handleMemories(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/deep-think-status")) {
    await handleDeepThinkStatus(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/deep-think")) {
    await handleDeepThink(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/regenerate-intelligence")) {
    await handleRegenerateIntelligence(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/trades")) {
    await handleTrades(req, res);
    return;
  }

  if (req.method === "GET" && pathOnly === "/api/notion/connect") {
    await handleNotionConnect(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/notion/callback")) {
    await handleNotionCallback(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/notion/databases")) {
    await handleNotionDatabases(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/notion/columns")) {
    await handleNotionColumns(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/notion/auto-map")) {
    await handleNotionAutoMap(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/notion/save-mapping")) {
    await handleNotionSaveMapping(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/notion/connection-status")) {
    await handleNotionConnectionStatus(req, res);
    return;
  }

  if (req.method === "DELETE" && req.url.startsWith("/api/notion/disconnect")) {
    await handleNotionDisconnect(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/notion/sync-user")) {
    await handleNotionSyncUser(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/notion/reconcile-archive")) {
    await handleNotionReconcileArchive(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/economic-calendar")) {
    await handleEconomicCalendar(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/ping")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/snapshot")) {
    await handleSnapshot(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/sync-notion")) {
    await handleSyncNotion(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/init-profiles")) {
    await handleInitProfiles(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/journal-fields")) {
    await handleJournalFields(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/journal-photo-slots")) {
    await handleJournalPhotoSlotsGet(req, res);
    return;
  }
  if (req.method === "PATCH" && req.url.startsWith("/api/journal-photo-slots")) {
    await handleJournalPhotoSlotsPatch(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/journal-trades")) {
    await handleJournalTradesGet(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/log-trade")) {
    await handleLogTrade(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/csv-import")) {
    await handleCsvImport(req, res);
    return;
  }

  if (req.method === "PATCH" && req.url.startsWith("/api/journal-trades")) {
    await handleJournalTradePatch(req, res);
    return;
  }
  if (req.method === "DELETE" && req.url.startsWith("/api/journal-trades")) {
    await handleJournalTradeDelete(req, res);
    return;
  }
  if (req.method === "PATCH" && req.url.startsWith("/api/trades-row")) {
    await handleTradeRowPatch(req, res);
    return;
  }
  if (req.method === "DELETE" && req.url.startsWith("/api/trades-row")) {
    await handleTradeRowDelete(req, res);
    return;
  }

  if (req.method === "GET" && req.url.split("?")[0].match(/^\/api\/accounts\/[^/]+\/?$/)) {
    await handleTradingAccountsGetSingle(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/accounts")) {
    await handleTradingAccountsGet(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0].match(/^\/api\/accounts\/[^/]+\/archive\/?$/)) {
    await handleAccountsArchive(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0].match(/^\/api\/accounts\/[^/]+\/restore\/?$/)) {
    await handleAccountsRestore(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0].match(/^\/api\/accounts\/[^/]+\/mark-passed\/?$/)) {
    await handleAccountsMarkPassed(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0].match(/^\/api\/accounts\/[^/]+\/mark-blown\/?$/)) {
    await handleAccountsMarkBlown(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/accounts")) {
    await handleTradingAccountsPost(req, res);
    return;
  }

  if (req.method === "PATCH" && req.url.split("?")[0].match(/^\/api\/accounts\/[^/]+\/?$/)) {
    await handleTradingAccountsPatch(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/capital-overview")) {
    await handleCapitalOverview(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/equity-log")) {
    await handleEquityLog(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/payouts")) {
    await handlePayouts(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/account-snapshots")) {
    await handleAccountSnapshotsGet(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/account-snapshots")) {
    await handleAccountSnapshotsPost(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/admin/sync-journal-fields")) {
    await handleAdminSyncJournalFields(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/admin/users")) {
    await handleAdminUsers(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/admin/dev-login")) {
    await handleAdminDevLogin(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/sync-mum")) {
    try {
      const syncMeta = await maybeSyncNotion(AUTH_USER_ID_MUM, { force: true });
      if (syncMeta.ok && !syncMeta.skipped) firePostSyncBrain(AUTH_USER_ID_MUM);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          syncMeta.ok && !syncMeta.skipped
            ? { ok: true, fetched: syncMeta.fetched, upserted: syncMeta.upserted }
            : { ok: false, error: syncMeta.reason || "Sync failed" }
        )
      );
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/user/profile")) {
    await handleUserProfileGet(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/user/profile")) {
    await handleUserProfile(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/user/onboarding-state")) {
    await handleOnboardingState(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/user/jarvis-intro")) {
    await handleJarvisIntro(req, res);
    return;
  }

  if (req.method !== "GET") {
    send(res, 405, "Method not allowed");
    return;
  }

  let filePath = safeJoin(STATIC_ROOT, req.url === "/" ? "/index.html" : req.url);
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath);
  const type = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 500, "Error reading file");
      return;
    }
    let body = data;
    const headers = { "Content-Type": type };
    if (
      !process.env.VERCEL &&
      (ext === ".html" || ext === ".htm") &&
      Buffer.isBuffer(data)
    ) {
      const inject = Buffer.from(
        '<script>new EventSource("/__livereload").onmessage=function(){location.reload()};</script>'
      );
      body = Buffer.concat([data, inject]);
    }
    send(res, 200, body, headers);
  });
}

// === NOTION OAUTH ===

const NOTION_OAUTH_REDIRECT_URI = "https://operation-jarvis2.vercel.app/api/notion/callback";

async function handleNotionConnect(req, res) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    json(res, 500, { error: "NOTION_OAUTH_CLIENT_ID not configured" });
    return;
  }

  const { searchParams } = new URL(req.url, "http://localhost");
  const authUserId = searchParams.get("user_id");
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!authUserId || !UUID_RE.test(authUserId)) {
    json(res, 400, { error: "Missing or invalid user_id" });
    return;
  }
  const state = encodeURIComponent(authUserId);
  const authUrl =
    `https://api.notion.com/v1/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&owner=user` +
    `&redirect_uri=${encodeURIComponent(NOTION_OAUTH_REDIRECT_URI)}` +
    `&state=${state}`;
  send(res, 302, "", { Location: authUrl });
}

async function handleNotionCallback(req, res) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    json(res, 500, { error: "Notion OAuth credentials not configured" });
    return;
  }

  const { searchParams } = new URL(req.url, `http://localhost`);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const authUserId = resolveAuthUserIdFromOAuthState(state);

  if (!code) {
    json(res, 400, { error: "Missing code from Notion callback" });
    return;
  }
  if (!authUserId) {
    json(res, 400, { error: "Invalid OAuth state — sign in and connect Notion again." });
    return;
  }

  let tokenData;
  try {
    console.log("[notion/callback] client_id prefix:", clientId?.slice(0, 8), "secret prefix:", clientSecret?.slice(0, 8), "redirect_uri:", NOTION_OAUTH_REDIRECT_URI);
    const tokenResponse = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Content-Type": "application/json",
        "Notion-Version": "2025-09-03",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: NOTION_OAUTH_REDIRECT_URI,
      }),
    });
    if (!tokenResponse.ok) {
      const err = await tokenResponse.text().catch(() => "unknown");
      json(res, 502, { error: `Notion token exchange failed: ${err}` });
      return;
    }
    tokenData = await tokenResponse.json();
  } catch (e) {
    json(res, 502, { error: `Notion token exchange error: ${String(e.message ?? e)}` });
    return;
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 500, { error: "Supabase not configured" });
    return;
  }

  const row = {
    user_id: legacyEmailForAuthUserId(authUserId) || authUserId,
    access_token: tokenData.access_token,
    workspace_name: tokenData.workspace_name ?? null,
    workspace_id: tokenData.workspace_id ?? null,
    bot_id: tokenData.bot_id ?? null,
    created_at: new Date().toISOString(),
  };

  console.log("[notion/callback] saving user_id:", row.user_id, "authUserId:", authUserId,
    "token prefix:", row.access_token ? row.access_token.slice(0, 6) : "MISSING",
    "workspace:", row.workspace_name, "token fields:", Object.keys(tokenData).join(","));

  let upsertOk = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const upsertRes = await fetch(`${url}/rest/v1/notion_connections?on_conflict=user_id`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
      });
      const upsertBody = await upsertRes.text().catch(() => "");
      if (upsertRes.ok) {
        console.log(`[notion/callback] upsert ok (attempt ${attempt}) status=${upsertRes.status} user=${authUserId} user_id=${row.user_id}`);
        upsertOk = true;
        break;
      }
      console.error(`[notion/callback] upsert failed (attempt ${attempt}) status=${upsertRes.status} user=${authUserId} user_id=${row.user_id} body=${upsertBody.slice(0, 400)}`);
    } catch (e) {
      console.error(`[notion/callback] upsert error (attempt ${attempt}):`, String(e.message ?? e));
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt));
  }

  if (!upsertOk) {
    console.error("[notion/callback] ALL upsert attempts failed — token NOT saved — user:", authUserId, "user_id:", row.user_id);
  }

  // Small delay so the token write propagates before the client reads it
  await new Promise(r => setTimeout(r, 500));
  send(res, 302, "", { Location: "/notion-setup.html?onboarding=true" });
}

/**
 * Query notion_connections or notion_mappings by user_id, falling back to the
 * auth UUID if no row is found for the email. Handles rows stored before the
 * email→UUID mapping existed (user_id stored as UUID instead of email).
 */
async function fetchNotionUserRows(url, key, table, emailUserId, authUserId) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
  const r1 = await fetch(
    `${url}/rest/v1/${table}?user_id=eq.${encodeURIComponent(emailUserId)}&limit=1`,
    { headers }
  );
  const rows1 = await r1.json().catch(() => null);
  if (Array.isArray(rows1) && rows1.length > 0) return rows1;
  if (emailUserId !== authUserId) {
    const r2 = await fetch(
      `${url}/rest/v1/${table}?user_id=eq.${encodeURIComponent(authUserId)}&limit=1`,
      { headers }
    );
    return (await r2.json().catch(() => null)) ?? [];
  }
  return rows1 ?? [];
}

async function handleNotionDatabases(req, res) {
  const authUid = authUserIdFromReq(req);
  if (!authUid) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }
  // notion_connections.user_id stores email for known users, UUID for new OAuth users
  const userId = legacyEmailForAuthUserId(authUid) || authUid;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 500, { error: "Supabase not configured" });
    return;
  }

  console.log(`[notion/databases] authUid=${authUid} userId=${userId}`);

  let accessToken;
  try {
    const rows = await fetchNotionUserRows(url, key, "notion_connections", userId, authUid);
    const rowCount = Array.isArray(rows) ? rows.length : "parse-failed";
    console.log(`[notion/databases] connection rows=${rowCount}`);
    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      accessToken = row.access_token ?? null;
      console.log(`[notion/databases] token=${accessToken ? `found(${String(accessToken).slice(0, 6)}…)` : "null/missing"} workspace=${row.workspace_name ?? "?"}`);
    } else {
      console.log(`[notion/databases] no connection row — authUid=${authUid} userId=${userId}`);
    }
  } catch (e) {
    console.error("[notion/databases] Supabase fetch error:", String(e.message ?? e));
    json(res, 500, { error: "Failed to read Notion connection" });
    return;
  }

  if (!accessToken) {
    json(res, 404, { error: "No Notion connection found for this user" });
    return;
  }

  const notionHeaders = {
    Authorization: `Bearer ${accessToken}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  // Paginated Notion search — collects all pages of results (max 5 pages = 500 items)
  async function searchAllPages(filter) {
    const all = [];
    let cursor = null;
    for (let page = 0; page < 5; page++) {
      const body = filter ? { filter } : {};
      if (cursor) body.start_cursor = cursor;
      const sr = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify(body),
      });
      console.log(`[notion/databases] search filter=${filter ? filter.value : "none"} page=${page + 1} status=${sr.status}`);
      if (!sr.ok) {
        const err = await sr.text().catch(() => "unknown");
        console.error(`[notion/databases] search failed: ${err.slice(0, 300)}`);
        break;
      }
      const data = await sr.json();
      const results = data.results ?? [];
      console.log(`[notion/databases] search filter=${filter ? filter.value : "none"} page=${page + 1} items=${results.length} has_more=${data.has_more} types=${[...new Set(results.map(r => r.object))].join(",") || "none"}`);
      all.push(...results);
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
    return all;
  }

  try {
    // Two parallel searches:
    //   1. filter=database  — explicitly finds all databases the token can access
    //   2. no filter        — finds pages (to inspect for nested child_database blocks)
    // Running both ensures we catch databases whether they appear directly or are embedded in pages.
    const [dbOnlyResults, allResults] = await Promise.all([
      searchAllPages({ value: "database", property: "object" }),
      searchAllPages(null),
    ]);

    const dbMap = new Map();
    const pageIds = new Set();

    for (const item of [...dbOnlyResults, ...allResults]) {
      if (item.object === "database" && !dbMap.has(item.id)) {
        dbMap.set(item.id, {
          id: item.id,
          name: item.title?.[0]?.plain_text ?? item.title?.[0]?.text?.content ?? "Untitled",
        });
      } else if (item.object === "page" && !pageIds.has(item.id)) {
        pageIds.add(item.id);
      }
    }

    console.log(`[notion/databases] direct dbs=${dbMap.size} pages_to_inspect=${pageIds.size}`);

    // Inspect child blocks of every page to find nested child_database blocks
    await Promise.all(
      [...pageIds].map(async (pageId) => {
        try {
          const br = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
            headers: notionHeaders,
          });
          if (!br.ok) return;
          const bdata = await br.json();
          for (const block of bdata.results ?? []) {
            if (block.type === "child_database" && !dbMap.has(block.id)) {
              dbMap.set(block.id, {
                id: block.id,
                name: block.child_database?.title ?? "Untitled",
              });
            }
          }
        } catch {
          // skip pages we can't read
        }
      })
    );

    console.log(`[notion/databases] total=${dbMap.size}`);
    json(res, 200, { databases: Array.from(dbMap.values()) });
  } catch (e) {
    console.error("[notion/databases] outer error:", String(e.message ?? e));
    json(res, 502, { error: `Notion databases error: ${String(e.message ?? e)}` });
  }
}

// === NOTION COLUMN MAPPING & USER SYNC ===

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
}

function notionPropValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case "title":
      return Array.isArray(prop.title) ? prop.title.map(b => b?.plain_text ?? "").join("") || null : null;
    case "rich_text":
      return Array.isArray(prop.rich_text) ? prop.rich_text.map(b => b?.plain_text ?? "").join("") || null : null;
    case "number": return prop.number ?? null;
    case "select": return prop.select?.name ?? null;
    case "status": return prop.status?.name ?? null;
    case "multi_select":
      return Array.isArray(prop.multi_select) && prop.multi_select.length > 0
        ? prop.multi_select.map(o => o?.name ?? "").filter(Boolean).join(", ") : null;
    case "date": return prop.date?.start ?? null;
    case "checkbox": return prop.checkbox ?? null;
    case "url": return prop.url ?? null;
    case "email": return prop.email ?? null;
    case "phone_number": return prop.phone_number ?? null;
    case "files":
      return Array.isArray(prop.files)
        ? prop.files.map(f => f.external?.url ?? f.file?.url).filter(Boolean)
        : null;
    case "formula": {
      const f = prop.formula;
      if (!f) return null;
      if (f.type === "string") return f.string ?? null;
      if (f.type === "number") return typeof f.number === "number" ? f.number : null;
      if (f.type === "boolean") return f.boolean ?? null;
      if (f.type === "date") return f.date?.start ?? null;
      return null;
    }
    case "relation":
      return Array.isArray(prop.relation) && prop.relation.length > 0
        ? prop.relation.map(r => r?.id).filter(Boolean).join(", ") : null;
    case "rollup": {
      const r = prop.rollup;
      if (!r) return null;
      if (r.type === "number") return typeof r.number === "number" ? r.number : null;
      if (r.type === "date") return r.date?.start ?? null;
      if (r.type === "array" && Array.isArray(r.array)) {
        for (const item of r.array) {
          const v = item && typeof item === "object" && "type" in item ? notionPropValue(item) : (item ?? null);
          if (v != null && v !== "") return v;
        }
        return null;
      }
      return null;
    }
    case "people":
      return Array.isArray(prop.people) && prop.people.length > 0
        ? prop.people.map(p => p?.name || p?.id).filter(Boolean).join(", ") : null;
    case "created_by":
    case "last_edited_by":
      return prop[prop.type]?.name || prop[prop.type]?.id || null;
    case "created_time": return prop.created_time ?? null;
    case "last_edited_time": return prop.last_edited_time ?? null;
    case "unique_id": {
      const uid = prop.unique_id;
      if (!uid) return null;
      return uid.prefix ? `${uid.prefix}-${uid.number}` : String(uid.number ?? "");
    }
    default: return null;
  }
}

function notionGetProp(props, colName) {
  if (!props || !colName) return null;
  const prop = Object.prototype.hasOwnProperty.call(props, colName)
    ? props[colName]
    : Object.entries(props).find(([k]) => k.toLowerCase() === String(colName).toLowerCase())?.[1];
  return notionPropValue(prop ?? null);
}

// ─── Universal Notion Sync Engine ────────────────────────────────────────────

const SYNC_UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const normalizePageId = (id) => String(id ?? "").replace(/-/g, "").toLowerCase();

function extractPageTitle(page) {
  if (!page?.properties) return "";
  for (const prop of Object.values(page.properties)) {
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const t = prop.title.map(b => b?.plain_text ?? "").join("").trim();
      if (t) return t;
    }
  }
  return "";
}

/** Fetch all supporting databases and build Map<normalizedPageId, pageTitle>. */
async function buildRelationLookupCache(accessToken, mainDatabaseId) {
  const cache = new Map();
  const t0 = Date.now();
  const mainNorm = normalizePageId(mainDatabaseId);

  let databases = [];
  try {
    let cursor;
    let page = 0;
    do {
      const body = { filter: { value: "database", property: "object" }, page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const r = await fetch("https://api.notion.com/v1/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) break;
      const data = await r.json();
      databases.push(...(data.results ?? []).filter(d => normalizePageId(d.id) !== mainNorm));
      cursor = data.has_more ? data.next_cursor : undefined;
      page++;
    } while (cursor && page < 5);
  } catch (e) {
    console.log("[NOTION-SYNC] cache: db-search failed: %s", String(e.message ?? e));
  }

  console.log("[NOTION-SYNC] cache: supporting-dbs=%d", databases.length);

  for (const db of databases) {
    const dbId = db.id;
    let pageCursor;
    let fetched = 0;
    try {
      do {
        const body = { page_size: 100 };
        if (pageCursor) body.start_cursor = pageCursor;
        const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) break;
        const data = await r.json();
        for (const p of (data.results ?? [])) {
          const title = extractPageTitle(p);
          if (title) cache.set(normalizePageId(p.id), title);
        }
        fetched += (data.results ?? []).length;
        pageCursor = data.has_more ? data.next_cursor : undefined;
      } while (pageCursor);
    } catch (e) {
      console.log("[NOTION-SYNC] cache: db=%s err=%s", dbId, String(e.message ?? e));
    }
    console.log("[NOTION-SYNC] cache: db=%s pages=%d", dbId, fetched);
  }

  console.log("[NOTION-SYNC] cache: total-entries=%d elapsed=%dms", cache.size, Date.now() - t0);
  return cache;
}

/** Collect every relation page ID referenced across all trade pages. */
function collectRelationIds(allPages) {
  const ids = new Set();
  for (const page of allPages) {
    for (const prop of Object.values(page.properties ?? {})) {
      if (prop?.type === "relation" && Array.isArray(prop.relation)) {
        for (const r of prop.relation) {
          if (r?.id) ids.add(r.id);
        }
      }
    }
  }
  return [...ids];
}

/**
 * Fetch individual pages not already in the cache via GET /v1/pages/{id}.
 * Notion often permits page-level access even when the parent DB wasn't shared.
 */
async function lazyFetchRelationPages(accessToken, cache, pageIds) {
  const missing = pageIds.filter(id => !cache.has(normalizePageId(id)));
  if (missing.length === 0) return { fetched: 0, failed: 0 };

  console.log("[NOTION-SYNC] lazy-fetch: resolving %d uncached relation IDs", missing.length);
  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < missing.length; i++) {
    if (i > 0 && i % 10 === 0) await new Promise(r => setTimeout(r, 150));
    const id = missing[i];
    try {
      const r = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(id)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (!r.ok) {
        failed++;
        console.log("[NOTION-SYNC] lazy-fetch: id=%s status=%d (inaccessible)", id, r.status);
        continue;
      }
      const page = await r.json();
      const title = extractPageTitle(page);
      if (title) { cache.set(normalizePageId(id), title); fetched++; }
      else failed++;
    } catch (e) {
      failed++;
      console.log("[NOTION-SYNC] lazy-fetch: id=%s err=%s", id, String(e.message ?? e));
    }
  }

  console.log("[NOTION-SYNC] lazy-fetch: done fetched=%d failed=%d", fetched, failed);
  return { fetched, failed };
}

/** Resolve prop value for sync, looking up relation IDs in cache. Returns "" not null. */
function oauthExtractPropValue(prop, cache) {
  if (!prop) return "";
  switch (prop.type) {
    case "title":
      return Array.isArray(prop.title) ? prop.title.map(b => b?.plain_text ?? "").join("").trim() : "";
    case "rich_text":
      return Array.isArray(prop.rich_text) ? prop.rich_text.map(b => b?.plain_text ?? "").join("").trim() : "";
    case "number":
      return prop.number != null ? prop.number : "";
    case "select":
      return prop.select?.name ?? "";
    case "status":
      return prop.status?.name ?? "";
    case "multi_select":
      return Array.isArray(prop.multi_select)
        ? prop.multi_select.map(o => o?.name ?? "").filter(Boolean).join(", ")
        : "";
    case "date":
      return prop.date?.start ?? "";
    case "checkbox":
      return typeof prop.checkbox === "boolean" ? (prop.checkbox ? "Yes" : "No") : "";
    case "url":
      return prop.url ?? "";
    case "email":
      return prop.email ?? "";
    case "phone_number":
      return prop.phone_number ?? "";
    case "formula": {
      const f = prop.formula;
      if (!f) return "";
      if (f.type === "string") return f.string ?? "";
      if (f.type === "number") return typeof f.number === "number" ? f.number : "";
      if (f.type === "boolean") return typeof f.boolean === "boolean" ? (f.boolean ? "Yes" : "No") : "";
      if (f.type === "date") return f.date?.start ?? "";
      return "";
    }
    case "relation": {
      if (!Array.isArray(prop.relation) || prop.relation.length === 0) return "";
      const titles = [];
      for (const r of prop.relation) {
        const id = r?.id; if (!id) continue;
        const title = cache?.get(normalizePageId(id));
        if (title) titles.push(title);
      }
      return titles.join(", ");
    }
    case "rollup": {
      const ro = prop.rollup; if (!ro) return "";
      if (ro.type === "number") return typeof ro.number === "number" ? ro.number : "";
      if (ro.type === "date") return ro.date?.start ?? "";
      if (ro.type === "array" && Array.isArray(ro.array)) {
        return ro.array.map(item => oauthExtractPropValue(item, cache)).filter(v => v !== "").join(", ");
      }
      return "";
    }
    case "people":
      return Array.isArray(prop.people) ? prop.people.map(p => p?.name ?? "").filter(Boolean).join(", ") : "";
    case "created_by":
      return prop.created_by?.name ?? "";
    case "last_edited_by":
      return prop.last_edited_by?.name ?? "";
    case "created_time":
      return prop.created_time ?? "";
    case "last_edited_time":
      return prop.last_edited_time ?? "";
    case "unique_id": {
      const uid = prop.unique_id; if (!uid) return "";
      return uid.prefix ? `${uid.prefix}-${uid.number}` : String(uid.number ?? "");
    }
    case "files": {
      if (!Array.isArray(prop.files)) return "";
      return prop.files.map(f => f.external?.url ?? f.file?.url).filter(Boolean).join(", ");
    }
    default: return "";
  }
}

function findPropByName(props, colName) {
  if (!props || !colName) return null;
  if (Object.prototype.hasOwnProperty.call(props, colName)) return props[colName];
  const lower = String(colName).toLowerCase();
  for (const [k, v] of Object.entries(props)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function notionGetPropResolved(props, colName, cache) {
  const prop = findPropByName(props, colName);
  if (!prop) return "";
  return oauthExtractPropValue(prop, cache);
}

// ─── Semantic resolvers ───────────────────────────────────────────────────────

const FOREX_PAIRS_RE = /\b(XAU\/?USD|GOLD|XAGUSD|BTC\/?USD|ETH\/?USD|EUR\/?USD|GBP\/?USD|USD\/?JPY|USD\/?CAD|AUD\/?USD|NZD\/?USD|USD\/?CHF|GBP\/?JPY|EUR\/?JPY|EUR\/?GBP|NAS\/?DAQ|NASDAQ|NAS100|US30|US500|SPX|NQ|ES|YM|MNQ|MES|MYM|DAX|FTSE|NDX|GC|CL|SI|NG)\b/i;

function normalizeOutcome(s) {
  const lower = String(s ?? "").trim().toLowerCase();
  if (!lower) return null;
  if (/\bwin\b|won|profit|green|take.?profit|partial.?win|✓|✅|pass/.test(lower)) return "win";
  if (/\bloss\b|lost|red|fail|stop.?loss|partial.?loss|❌|stopped/.test(lower)) return "loss";
  if (/break.?even|be\b|scratch|0r/.test(lower)) return "breakeven";
  return null;
}

function resolveOAuthRR(props, mapping) {
  // 1. Mapped column
  if (mapping?.rr) {
    const prop = findPropByName(props, mapping.rr);
    if (prop) {
      const v = notionPropValue(prop);
      if (v != null) {
        const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
        if (!isNaN(n)) return n;
      }
    }
  }
  // 2. Heuristic: any number/formula prop with RR-ish name
  const rrNames = ["rr", "r:r", "r/r", "risk reward", "risk-reward", "r multiple", "pnl"];
  for (const [name, prop] of Object.entries(props)) {
    const lower = name.toLowerCase();
    if (!rrNames.some(n => lower.includes(n))) continue;
    if (!prop || (prop.type !== "number" && prop.type !== "formula" && prop.type !== "rich_text")) continue;
    const v = notionPropValue(prop);
    if (v == null) continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
    if (!isNaN(n)) return n;
  }
  return null;
}

function resolveOAuthOutcome(props, mapping, cache, rrClean) {
  // 1. Mapped outcome column — full type chain
  if (mapping?.outcome) {
    const prop = findPropByName(props, mapping.outcome);
    if (prop) {
      // Checkbox: true → win, false → loss (direct boolean outcome)
      if (prop.type === "checkbox") {
        if (typeof prop.checkbox === "boolean") return prop.checkbox ? "win" : "loss";
      // Formula boolean: same mapping
      } else if (prop.type === "formula" && prop.formula?.type === "boolean") {
        const b = prop.formula.boolean;
        if (typeof b === "boolean") return b ? "win" : "loss";
      } else {
        // select, status, relation (resolved to title), rich_text, etc.
        const v = String(oauthExtractPropValue(prop, cache)).trim();
        const norm = normalizeOutcome(v);
        if (norm) return norm;
        // Don't return raw unrecognised strings — fall through to RR inference
      }
    }
  }
  // 2. Scan for outcome-named select/status/formula props
  const outcomeNames = ["outcome", "result", "trade result", "p&l", "win/loss"];
  for (const [name, prop] of Object.entries(props)) {
    if (mapping?.outcome && name === mapping.outcome) continue;
    if (!outcomeNames.some(n => name.toLowerCase().includes(n))) continue;
    if (!prop) continue;
    if (prop.type === "checkbox") {
      if (typeof prop.checkbox === "boolean") return prop.checkbox ? "win" : "loss";
    } else if (prop.type === "formula" && prop.formula?.type === "boolean") {
      const b = prop.formula.boolean;
      if (typeof b === "boolean") return b ? "win" : "loss";
    } else if (prop.type === "select" || prop.type === "status" || prop.type === "relation") {
      const v = String(oauthExtractPropValue(prop, cache)).trim();
      const norm = normalizeOutcome(v);
      if (norm) return norm;
    }
  }
  // 3. RR sign inference
  if (rrClean != null) {
    if (rrClean > 0) return "win";
    if (rrClean < 0) return "loss";
    return "breakeven";
  }
  return "unknown";
}

const PAIR_SCAN_TYPES = new Set(["title", "rich_text", "select", "multi_select", "status", "formula", "relation"]);

function resolveOAuthPair(props, mapping, cache) {
  // 1. Mapped pair column
  if (mapping?.pair) {
    const prop = findPropByName(props, mapping.pair);
    if (prop) {
      const v = String(oauthExtractPropValue(prop, cache)).trim();
      if (v && !SYNC_UUID_RE.test(v)) return v;
    }
  }
  // 2. Scan text-bearing columns for known instrument patterns
  for (const prop of Object.values(props)) {
    if (!prop || !PAIR_SCAN_TYPES.has(prop.type)) continue;
    const v = String(oauthExtractPropValue(prop, cache)).trim();
    if (!v || SYNC_UUID_RE.test(v)) continue;
    const m = FOREX_PAIRS_RE.exec(v);
    if (m) return m[0].toUpperCase().replace("/", "");
  }
  return "";
}

/** Recursively replace UUID string arrays (relation IDs from notion-serialize-props) with resolved titles. */
function resolveUuidsInExtras(obj, cache) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    // notion-serialize-props stores relations as plain UUID string arrays: ["abc123", "def456"]
    if (obj.length > 0 && obj.every(x => typeof x === "string" && SYNC_UUID_RE.test(x.replace(/-/g, "")))) {
      const titles = obj.map(x => cache?.get(normalizePageId(x))).filter(Boolean);
      return titles.length > 0 ? titles.join(", ") : null;
    }
    return obj.map(item => resolveUuidsInExtras(item, cache));
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = resolveUuidsInExtras(v, cache);
  }
  return out;
}

async function handleNotionColumns(req, res) {
  const sp = new URL(req.url, "http://localhost").searchParams;
  const authUid = authUserIdFromReq(req);
  if (!authUid) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }
  // notion_connections.user_id stores email, not UUID
  const userId = legacyEmailForAuthUserId(authUid) || authUid;
  const databaseId = sp.get("database_id") || "";
  if (!databaseId) { json(res, 400, { error: "database_id required" }); return; }

  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) { json(res, 500, { error: "Supabase not configured" }); return; }

  let accessToken;
  try {
    const rows = await fetchNotionUserRows(url, srKey, "notion_connections", userId, authUid);
    accessToken = Array.isArray(rows) && rows.length > 0 ? rows[0].access_token : null;
  } catch { json(res, 500, { error: "Failed to read Notion connection" }); return; }

  if (!accessToken) { json(res, 404, { error: "No Notion connection found for this user" }); return; }

  try {
    // Step 1: fetch the database schema with 2025-09-03 (required for merged databases)
    // This gives us data_sources for merged DBs, or properties for standard DBs
    console.log("[notion/columns] fetching schema for:", databaseId);
    const schemaRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Notion-Version": "2025-09-03" },
    });
    const schemaRaw = await schemaRes.text();
    console.log("[notion/columns] schema status:", schemaRes.status, "body:", schemaRaw.slice(0, 400));

    if (!schemaRes.ok) {
      json(res, 502, { error: `Notion schema fetch failed (${schemaRes.status}): ${schemaRaw}` }); return;
    }

    const schema = JSON.parse(schemaRaw);

    // Stringify a prop value for sample display — compact, human-readable, never a UUID
    const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
    const sampleStr = (prop) => {
      if (!prop || prop.type === "relation" || prop.type === "people") return null;
      const v = notionPropValue(prop);
      if (v == null || v === "") return null;
      if (Array.isArray(v)) {
        const filtered = v.filter(s => !UUID_RE.test(String(s).trim()));
        return filtered.slice(0, 2).join(", ") || null;
      }
      const s = String(v).slice(0, 40);
      if (UUID_RE.test(s.trim())) return null;
      return s || null;
    };

    // Fetch up to N pages and extract {name, type, samples} per column
    const fetchSamplePages = async (endpoint, pageCount = 3) => {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: pageCount }),
      });
      const text = await r.text();
      console.log(`[notion/columns] sample query ${endpoint} → ${r.status}:`, text.slice(0, 300));
      if (!r.ok) return null;
      const data = JSON.parse(text);
      const pages = data.results ?? [];
      if (!pages.length || !pages[0]?.properties) return null;

      const sampleMap = {};
      for (const page of pages) {
        for (const [name, prop] of Object.entries(page.properties ?? {})) {
          if (!sampleMap[name]) sampleMap[name] = { type: prop.type ?? "unknown", samples: [] };
          if (sampleMap[name].samples.length < 3) {
            const s = sampleStr(prop);
            if (s && !sampleMap[name].samples.includes(s)) sampleMap[name].samples.push(s);
          }
        }
      }
      return Object.entries(sampleMap).map(([name, { type, samples }]) => ({ name, type, samples }));
    };

    // Columns from schema properties (no sample values — enrich below if possible)
    const columnsFromSchema = (schema.properties && Object.keys(schema.properties).length > 0)
      ? Object.entries(schema.properties).map(([name, prop]) => ({
          name,
          type: prop.type ?? "unknown",
          samples: [],
        }))
      : null;

    // For merged databases, Notion requires /data_sources/{id}/query
    const dataSources = Array.isArray(schema.data_sources) ? schema.data_sources : [];
    if (dataSources.length > 0) {
      const rawId = dataSources[0].id ?? dataSources[0];
      const dataSourceId = String(rawId).replace(/-/g, "");
      console.log("[notion/columns] merged DB — querying data_source:", dataSourceId);
      const cols = await fetchSamplePages(
        `https://api.notion.com/v1/data_sources/${dataSourceId}/query`
      );
      if (cols) {
        console.log("[notion/columns] data_source columns:", cols.map(c => c.name));
        json(res, 200, { columns: cols, data_source_id: dataSourceId });
        return;
      }
      json(res, 502, { error: "Could not retrieve columns from merged database data source." }); return;
    }

    // Standard DB: try to get samples from page query, fall back to schema
    const sampledCols = await fetchSamplePages(`https://api.notion.com/v1/databases/${databaseId}/query`);
    if (sampledCols) {
      console.log("[notion/columns] page-query columns:", sampledCols.length, "columns");
      json(res, 200, { columns: sampledCols });
      return;
    }

    if (columnsFromSchema) {
      console.log("[notion/columns] schema properties →", columnsFromSchema.length, "columns (no samples)");
      json(res, 200, { columns: columnsFromSchema });
      return;
    }

    json(res, 200, { columns: [], debug: "No pages found in database" });
  } catch (e) {
    json(res, 502, { error: `Notion columns error: ${String(e.message ?? e)}` });
  }
}

async function handleNotionAutoMap(req, res) {
  const authUid = authUserIdFromReq(req);
  if (!authUid) { json(res, 401, { error: "Unauthorized" }); return; }

  let body;
  try { body = await readBody(req); } catch { json(res, 400, { error: "Invalid request body" }); return; }
  const databaseId = body?.database_id || "";
  if (!databaseId) { json(res, 400, { error: "database_id required" }); return; }

  const userId = legacyEmailForAuthUserId(authUid) || authUid;
  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) { json(res, 500, { error: "Supabase not configured" }); return; }

  let accessToken;
  try {
    const rows = await fetchNotionUserRows(url, srKey, "notion_connections", userId, authUid);
    accessToken = Array.isArray(rows) && rows.length > 0 ? rows[0].access_token : null;
  } catch { json(res, 500, { error: "Failed to read Notion connection" }); return; }
  if (!accessToken) { json(res, 404, { error: "No Notion connection found" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) { json(res, 500, { error: "Anthropic API not configured" }); return; }

  try {
    const schemaRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Notion-Version": "2025-09-03" },
    });
    if (!schemaRes.ok) { json(res, 502, { error: "Failed to fetch Notion schema" }); return; }
    const schema = await schemaRes.json();

    const dataSources = Array.isArray(schema.data_sources) ? schema.data_sources : [];
    let dataSourceId = null;
    let queryUrl;
    if (dataSources.length > 0) {
      const rawId = dataSources[0].id ?? dataSources[0];
      dataSourceId = String(rawId).replace(/-/g, "");
      queryUrl = `https://api.notion.com/v1/data_sources/${dataSourceId}/query`;
    } else {
      queryUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;
    }

    const pagesRes = await fetch(queryUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: JSON.stringify({ page_size: 5 }),
    });
    const pagesData = pagesRes.ok ? await pagesRes.json() : { results: [] };
    const pages = pagesData.results ?? [];

    // Build relation cache + lazy-fetch uncached relation IDs from sample pages
    const amCache = await buildRelationLookupCache(accessToken, databaseId);
    const amRelIds = collectRelationIds(pages);
    await lazyFetchRelationPages(accessToken, amCache, amRelIds);

    const amSampleStr = (prop) => {
      if (!prop) return null;
      const v = oauthExtractPropValue(prop, amCache);
      if (v === "" || v == null) return null;
      const s = String(v).slice(0, 60);
      if (SYNC_UUID_RE.test(s.trim())) return null;
      return s;
    };

    const sampleMap = {};
    for (const page of pages) {
      for (const [name, prop] of Object.entries(page.properties ?? {})) {
        if (!sampleMap[name]) sampleMap[name] = { type: prop.type ?? "unknown", samples: [] };
        if (sampleMap[name].samples.length < 3) {
          const s = amSampleStr(prop);
          if (s && !sampleMap[name].samples.includes(s)) sampleMap[name].samples.push(s);
        }
      }
    }
    if (schema.properties) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (!sampleMap[name]) sampleMap[name] = { type: prop.type ?? "unknown", samples: [] };
      }
    }
    const columns = Object.entries(sampleMap).map(([name, { type, samples }]) => ({ name, type, samples }));

    if (columns.length === 0) {
      json(res, 200, { mapping: {}, confidence: "low", columns: [], data_source_id: dataSourceId });
      return;
    }

    const colsForPrompt = columns.map(({ name, type, samples }) => {
      const sp = samples.length > 0 ? ` — samples: ${samples.join(", ")}` : "";
      return `"${name}" (${type})${sp}`;
    }).join("\n");

    const promptText = `You are analysing a Notion trading journal database. Here are the column names, types, and sample values:\n\n${colsForPrompt}\n\nMap each column to the most appropriate Jarvis field:\n- date: the trade date/time\n- pair: the trading instrument/symbol\n- outcome: win/loss/breakeven result\n- rr: risk-reward ratio or R multiple\n- direction: long/short/buy/sell\n- session: trading session (London/NY/Asia)\n- model: trading setup or strategy name\n- notes: trade notes, summary, or review\n- account: trading account name\n- photos: chart images or screenshots\n\nReturn a JSON object where keys are Jarvis field names and values are the exact Notion column names. Only include fields you are confident about. For fields where no clear match exists, omit them entirely.\n\nAlso return a 'confidence' field: 'high' if you matched all required fields (date + pair), 'low' otherwise.\n\nReturn ONLY valid JSON, no other text.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: promptText }],
      }),
    });

    let mapping = {};
    let confidence = "low";
    if (aiRes.ok) {
      const aiData = await aiRes.json();
      const rawText = aiData.content?.[0]?.text ?? "";
      console.log("[notion/auto-map] AI raw:", rawText.slice(0, 400));
      try {
        const jsonStr = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
        const parsed = JSON.parse(jsonStr);
        confidence = parsed.confidence === "high" ? "high" : "low";
        delete parsed.confidence;
        const validNames = new Set(columns.map(c => c.name));
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && validNames.has(v)) mapping[k] = v;
        }
        if (!mapping.date || !mapping.pair) confidence = "low";
      } catch (e) {
        console.log("[notion/auto-map] parse error:", e.message);
      }
    } else {
      console.log("[notion/auto-map] AI call failed:", aiRes.status);
    }

    const ALL_FIELDS = ["date", "pair", "outcome", "rr", "direction", "session", "model", "notes", "account", "photos"];
    json(res, 200, {
      mapping,
      confidence,
      columns,
      unmatched_fields: ALL_FIELDS.filter(f => !mapping[f]),
      data_source_id: dataSourceId,
    });
  } catch (e) {
    console.log("[notion/auto-map] error:", String(e.message ?? e));
    json(res, 502, { error: String(e.message ?? e) });
  }
}

/** Best-effort: mirror Notion DB column order into journal_fields for LOG TRADE. */
async function maybeSyncJournalFieldsFromOAuth(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return { ok: false, reason: "no_user" };

  const conn = await loadNotionOAuthConnection(uid);
  if (!conn.ok) {
    return { ok: false, reason: conn.skipped ? conn.reason : conn.reason };
  }

  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) return { ok: false, reason: "supabase_not_configured" };

  let dataSourceId = conn.mapping.__data_source_id ?? null;
  if (dataSourceId != null && String(dataSourceId).trim()) {
    dataSourceId = String(dataSourceId).replace(/-/g, "");
  } else {
    dataSourceId = null;
  }

  // journal_fields uses user_id TEXT — for legacy users use email so conflict key matches existing rows
  const writeUid = legacyEmailForAuthUserId(uid) || uid;
  try {
    const result = await syncJournalFieldsFromOAuthConnection({
      userId: writeUid,
      accessToken: conn.accessToken,
      databaseId: conn.databaseId,
      dataSourceId,
      supabaseUrl: url,
      supabaseKey: srKey,
    });
    console.log(`[journal-fields] ${uid}: synced ${result.synced} fields from Notion OAuth`);
    return { ok: true, synced: result.synced };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[journal-fields] ${uid}: OAuth field sync failed:`, msg);
    return { ok: false, reason: msg };
  }
}

async function handleNotionSaveMapping(req, res) {
  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch { json(res, 400, { error: "Invalid JSON body" }); return; }

  const user_id = authUserIdFromReq(req);
  const { database_id, mapping, data_source_id } = body ?? {};
  if (!user_id || !database_id || !mapping) {
    json(res, 400, { error: "database_id and mapping required" });
    return;
  }

  // Embed data_source_id (for merged DBs) into the mapping JSON so sync can use it
  const mappingWithMeta = data_source_id
    ? { ...mapping, __data_source_id: data_source_id }
    : mapping;

  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) { json(res, 500, { error: "Supabase not configured" }); return; }

  try {
    const upsertRes = await fetch(`${url}/rest/v1/notion_mappings?on_conflict=user_id`, {
      method: "POST",
      headers: {
        apikey: srKey,
        Authorization: `Bearer ${srKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: legacyEmailForAuthUserId(user_id) || user_id, database_id, mapping: mappingWithMeta, created_at: new Date().toISOString() }),
    });
    if (!upsertRes.ok) {
      const err = await upsertRes.text().catch(() => "unknown");
      json(res, 502, { error: `Save mapping failed: ${err}` }); return;
    }

    const fieldSync = await maybeSyncJournalFieldsFromOAuth(user_id);
    json(res, 200, {
      success: true,
      journal_fields_synced: fieldSync.ok ? fieldSync.synced ?? 0 : 0,
      journal_fields_warning: fieldSync.ok ? undefined : fieldSync.reason,
    });
  } catch (e) {
    json(res, 502, { error: `Save mapping error: ${String(e.message ?? e)}` });
  }
}

// Parse a wide variety of date strings into "YYYY-MM-DD" for Postgres TIMESTAMPTZ.
// Handles ISO dates, Notion date objects, and free-text like "Tuesday 14/10 ".
function parseDateToIso(raw) {
  if (raw == null) return null;
  // Notion date properties return { start: "YYYY-MM-DD" } — already handled upstream,
  // but if a string slips through, normalise it.
  const s = String(raw).trim();
  if (!s) return null;

  // Already ISO YYYY-MM-DD[T...]
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : s.slice(0, 10);
  }

  // Strip leading day name ("Tuesday ", "Mon ", etc.)
  const cleaned = s.replace(/^[a-z]+\s+/i, "").trim();

  // DD/MM, DD/MM/YYYY, DD/MM/YY
  const dm = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const mon = parseInt(dm[2], 10);
    let yr  = dm[3] ? parseInt(dm[3], 10) : new Date().getFullYear();
    if (yr < 100) yr += 2000;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(yr, mon - 1, day));
      if (!isNaN(d.getTime()) && d.getUTCMonth() === mon - 1) {
        return d.toISOString().slice(0, 10);
      }
    }
  }

  // MM/DD/YYYY fallback
  const md = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (md) {
    const mon = parseInt(md[1], 10);
    const day = parseInt(md[2], 10);
    let yr  = parseInt(md[3], 10);
    if (yr < 100) yr += 2000;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(yr, mon - 1, day));
      if (!isNaN(d.getTime()) && d.getUTCMonth() === mon - 1) {
        return d.toISOString().slice(0, 10);
      }
    }
  }

  // Native parse last resort
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

/**
 * Like parseDateToIso but preserves the full timestamp when a time component is present.
 * Used only for Notion date property `.start` values.
 * @returns {{ iso: string, hasTime: boolean } | null}
 */
function parseDateToResult(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[Tt]\d/.test(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return { iso: s, hasTime: true };
  }
  const iso = parseDateToIso(raw);
  return iso ? { iso, hasTime: false } : null;
}

/**
 * Trade `date` for OAuth sync: prefer real Notion **date** properties (especially "Date")
 * before the user-mapped column — mappings often point at the DB **title**, which may be a
 * display string (e.g. 21/06/2026) that disagrees with the Date property.
 *
 * Order: canonical date props → mapped column if type date → any other date prop →
 * mapped non-date (text/title/formula string) → first title property text → created_time.
 */
function resolveNotionTradeDateIso(page, mapping, get) {
  const props = page?.properties;
  if (!props || typeof props !== "object") {
    return parseDateToIso(page?.created_time);
  }

  const usedKeys = new Set();

  const tryDatePropKey = (key) => {
    if (!key || !Object.prototype.hasOwnProperty.call(props, key)) return null;
    const prop = props[key];
    if (!prop || prop.type !== "date" || !prop.date?.start) return null;
    const iso = parseDateToIso(prop.date.start);
    if (!iso) return null;
    usedKeys.add(key);
    return iso;
  };

  const canonicalDateNames = ["Date", "date", "Trade Date", "trade date", "DATE", "Day", "Trade date"];
  for (let i = 0; i < canonicalDateNames.length; i++) {
    const iso = tryDatePropKey(canonicalDateNames[i]);
    if (iso) return iso;
  }

  const mapDateName =
    mapping && typeof mapping.date === "string" && mapping.date.trim() ? mapping.date.trim() : "";
  if (mapDateName) {
    const iso = tryDatePropKey(mapDateName);
    if (iso) return iso;
  }

  const sortedKeys = Object.keys(props).sort();
  for (let si = 0; si < sortedKeys.length; si++) {
    const k = sortedKeys[si];
    if (usedKeys.has(k)) continue;
    const iso = tryDatePropKey(k);
    if (iso) return iso;
  }

  const mappedProp = mapDateName ? props[mapDateName] : null;
  if (!mappedProp || mappedProp.type !== "date") {
    const raw = get("date");
    if (raw != null && String(raw).trim()) {
      const iso = parseDateToIso(raw);
      if (iso) return iso;
    }
  }

  for (let ti = 0; ti < sortedKeys.length; ti++) {
    const k = sortedKeys[ti];
    const prop = props[k];
    if (!prop || prop.type !== "title" || !Array.isArray(prop.title)) continue;
    const t = prop.title.map((b) => (typeof b?.plain_text === "string" ? b.plain_text : "")).join("").trim();
    if (!t) continue;
    const iso = parseDateToIso(t);
    if (iso) return iso;
  }

  return parseDateToIso(page.created_time);
}

/**
 * Like resolveNotionTradeDateIso but returns { iso, hasTime } so the caller can persist
 * whether a real clock time was present in Notion.  Fallback paths (title text, created_time,
 * free-text) always set hasTime=false — only Notion date property start values with T+time
 * set hasTime=true.
 * @returns {{ iso: string, hasTime: boolean } | null}
 */
function resolveNotionTradeDateWithMeta(page, mapping, get) {
  const props = page?.properties;
  if (!props || typeof props !== "object") {
    const iso = parseDateToIso(page?.created_time);
    return iso ? { iso, hasTime: false } : null;
  }

  const usedKeys = new Set();

  const tryDatePropKey = (key) => {
    if (!key || !Object.prototype.hasOwnProperty.call(props, key)) return null;
    const prop = props[key];
    if (!prop || prop.type !== "date" || !prop.date?.start) return null;
    const result = parseDateToResult(prop.date.start);
    if (!result) return null;
    usedKeys.add(key);
    return result;
  };

  const canonicalDateNames = ["Date", "date", "Trade Date", "trade date", "DATE", "Day", "Trade date"];
  for (let i = 0; i < canonicalDateNames.length; i++) {
    const r = tryDatePropKey(canonicalDateNames[i]);
    if (r) return r;
  }

  const mapDateName =
    mapping && typeof mapping.date === "string" && mapping.date.trim() ? mapping.date.trim() : "";
  if (mapDateName) {
    const r = tryDatePropKey(mapDateName);
    if (r) return r;
  }

  const sortedKeys = Object.keys(props).sort();
  for (let si = 0; si < sortedKeys.length; si++) {
    const k = sortedKeys[si];
    if (usedKeys.has(k)) continue;
    const r = tryDatePropKey(k);
    if (r) return r;
  }

  const mappedProp = mapDateName ? props[mapDateName] : null;
  if (!mappedProp || mappedProp.type !== "date") {
    const raw = get("date");
    if (raw != null && String(raw).trim()) {
      const iso = parseDateToIso(raw);
      if (iso) return { iso, hasTime: false };
    }
  }

  for (let ti = 0; ti < sortedKeys.length; ti++) {
    const k = sortedKeys[ti];
    const prop = props[k];
    if (!prop || prop.type !== "title" || !Array.isArray(prop.title)) continue;
    const t = prop.title.map((b) => (typeof b?.plain_text === "string" ? b.plain_text : "")).join("").trim();
    if (!t) continue;
    const iso = parseDateToIso(t);
    if (iso) return { iso, hasTime: false };
  }

  const iso = parseDateToIso(page.created_time);
  return iso ? { iso, hasTime: false } : null;
}

/**
 * Load OAuth token + column mapping from Supabase (no Notion API call).
 */
async function loadNotionOAuthConnection(userId) {
  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) {
    return { ok: false, skipped: false, reason: "Supabase not configured" };
  }

  // notion_connections and notion_mappings use user_id TEXT (email), not auth_user_id (UUID)
  const resolvedUserId = legacyEmailForAuthUserId(userId) || userId;

  try {
    const [connRows, mapRows] = await Promise.all([
      fetchNotionUserRows(url, srKey, "notion_connections", resolvedUserId, userId),
      fetchNotionUserRows(url, srKey, "notion_mappings", resolvedUserId, userId),
    ]);
    const accessToken =
      Array.isArray(connRows) && connRows.length > 0 ? connRows[0].access_token : null;
    const databaseId =
      Array.isArray(mapRows) && mapRows.length > 0 ? mapRows[0].database_id : null;
    let mapping = Array.isArray(mapRows) && mapRows.length > 0 ? mapRows[0].mapping : null;
    if (mapping != null && typeof mapping === "string") {
      try {
        mapping = JSON.parse(mapping);
      } catch {
        mapping = null;
      }
    }

    if (!accessToken) return { ok: false, skipped: true, reason: "no_connection" };
    if (!databaseId || mapping == null || typeof mapping !== "object" || Array.isArray(mapping)) {
      return { ok: false, skipped: true, reason: "no_mapping" };
    }

    return { ok: true, accessToken, databaseId, mapping };
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      reason: `Failed to read connection/mapping: ${String(e.message ?? e)}`,
    };
  }
}

/**
 * Load OAuth token + mapping and fetch all pages from the mapped Notion database / data source.
 * @returns {{ ok: true, skipped: false, pages: object[], mapping: object, accessToken: string } | { ok: false, skipped: true, reason: string, pages: [] } | { ok: false, skipped: false, reason: string, oauthAuthError?: boolean, status?: number, pages: [] }}
 */
async function notionOAuthFetchAllPages(userId) {
  const conn = await loadNotionOAuthConnection(userId);
  if (!conn.ok) {
    if (conn.skipped) {
      return { ok: false, skipped: true, reason: conn.reason, pages: [] };
    }
    return { ok: false, skipped: false, reason: conn.reason, pages: [] };
  }

  const { accessToken, databaseId, mapping } = conn;

  let dataSourceId = mapping.__data_source_id ?? null;
  if (dataSourceId != null && String(dataSourceId).trim()) {
    dataSourceId = String(dataSourceId).replace(/-/g, "");
  } else {
    dataSourceId = null;
  }

  const notionQueryUrl = dataSourceId
    ? `https://api.notion.com/v1/data_sources/${dataSourceId}/query`
    : `https://api.notion.com/v1/databases/${databaseId}/query`;

  const allPages = [];
  let cursor = undefined;
  try {
    do {
      const qBody = { page_size: 100 };
      if (cursor) qBody.start_cursor = cursor;
      const qRes = await fetch(notionQueryUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(qBody),
      });
      if (!qRes.ok) {
        const err = await qRes.text().catch(() => "unknown");
        const authFail = qRes.status === 401 || qRes.status === 403;
        return {
          ok: false,
          skipped: false,
          reason: `Notion query failed: ${err}`,
          oauthAuthError: authFail,
          status: qRes.status,
          pages: [],
        };
      }
      const data = await qRes.json();
      allPages.push(...(data.results ?? []));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  } catch (e) {
    return { ok: false, skipped: false, reason: String(e.message ?? e), pages: [] };
  }

  return { ok: true, skipped: false, pages: allPages, mapping, accessToken, databaseId };
}

/** Same shape as `extractTradeImagesFromProps` in notion-sync.mjs — every `files` property on the page. */
function oauthExtractTradeImageUrlsFromProps(props) {
  const urls = [];
  if (!props || typeof props !== "object") return urls;
  for (const prop of Object.values(props)) {
    if (!prop || prop.type !== "files" || !Array.isArray(prop.files)) continue;
    for (const f of prop.files) {
      if (!f) continue;
      const u =
        f.type === "external" && f.external?.url
          ? String(f.external.url).trim()
          : f.type === "file" && f.file?.url
            ? String(f.file.url).trim()
            : "";
      if (u && /^https?:\/\//i.test(u)) urls.push(u);
    }
  }
  return urls;
}

function oauthNormalizeTradeImageEntry(x) {
  if (typeof x === "string") {
    const u = x.trim();
    if (!/^https?:\/\//i.test(u)) return null;
    return { url: u, label: "" };
  }
  if (x && typeof x === "object" && typeof x.url === "string") {
    const u = x.url.trim();
    if (!/^https?:\/\//i.test(u)) return null;
    return {
      url: u,
      label: typeof x.label === "string" ? x.label.trim() : "",
    };
  }
  return null;
}

/** Match notion-sync `mergeTradeImages`: second argument’s URLs are emitted first (page-body captions win). */
function oauthMergeTradeImages(baseList, fromBlocks) {
  const merged = [];
  const seen = new Set();
  for (const raw of fromBlocks || []) {
    const n = oauthNormalizeTradeImageEntry(raw);
    if (n && !seen.has(n.url)) {
      seen.add(n.url);
      merged.push(n);
    }
  }
  for (const raw of baseList || []) {
    const n = oauthNormalizeTradeImageEntry(raw);
    if (n && !seen.has(n.url)) {
      seen.add(n.url);
      merged.push(n);
    }
  }
  return merged;
}

/** `get("photos")` from column mapping — string[], url string, or {url,label}[]. */
function oauthCoerceMappedPhotos(raw) {
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") {
    const u = raw.trim();
    if (/^https?:\/\//i.test(u)) return [{ url: u, label: "" }];
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const n = oauthNormalizeTradeImageEntry(item);
    if (n) out.push(n);
  }
  return out;
}

async function enrichOAuthSyncTradeImages(accessToken, rows, pages, mapping) {
  if (!Array.isArray(rows) || !Array.isArray(pages) || rows.length !== pages.length || !mapping) return;
  const conc = Math.min(
    8,
    Math.max(1, Number(process.env.NOTION_BODY_IMAGE_CONCURRENCY) || 6)
  );

  const runOne = async (row, page) => {
    const props = page.properties ?? {};
    const get = (field) => notionPropValue(props[mapping[field]]);
    const mapped = oauthCoerceMappedPhotos(get("photos"));
    const fileEntries = oauthExtractTradeImageUrlsFromProps(props).map((url) => ({ url, label: "" }));
    const propBase = oauthMergeTradeImages(fileEntries, mapped);
    let fromBlocks = [];
    if (accessToken) {
      try {
        fromBlocks = await fetchTradeImagesFromNotionPageBlocks(accessToken, page.id, {
          maxUrls: 48,
          maxBlockRequests: 150,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[notion-oauth-sync] page body images ${page?.id}: ${msg}`);
      }
    }
    row.trade_images = oauthMergeTradeImages(propBase, fromBlocks);
  };

  for (let i = 0; i < rows.length; i += conc) {
    const rChunk = rows.slice(i, i + conc);
    const pChunk = pages.slice(i, i + conc);
    await Promise.all(rChunk.map((row, j) => runOne(row, pChunk[j])));
  }
}

async function patchTradesArchivedByNotionIds(supabaseUrl, tableEnc, srKey, userId, notionIds, archived) {
  if (!notionIds.length) return { ok: true, patched: 0 };
  const encUser = encodeURIComponent(userId);
  const CH = 40;
  let patched = 0;
  for (let i = 0; i < notionIds.length; i += CH) {
    const chunk = notionIds.slice(i, i + CH);
    const inList = chunk.map((id) => encodeURIComponent(id)).join(",");
    const patchUrl = `${supabaseUrl}/rest/v1/${tableEnc}?auth_user_id=eq.${encUser}&notion_id=in.(${inList})`;
    const pr = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        apikey: srKey,
        Authorization: `Bearer ${srKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ archived, updated_at: new Date().toISOString() }),
    });
    if (!pr.ok) {
      const err = await pr.text().catch(() => "unknown");
      return { ok: false, patched, error: err };
    }
    patched += chunk.length;
  }
  return { ok: true, patched };
}

async function fetchTradeRowsNotionIdArchived(supabaseUrl, tableEnc, srKey, userId) {
  const encUser = encodeURIComponent(userId);
  const archSelect = TRADE_ARCHIVED_ACTIVE ? "notion_id,archived" : "notion_id";
  const all = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const end = start + pageSize - 1;
    const endpoint = `${supabaseUrl}/rest/v1/${tableEnc}?auth_user_id=eq.${encUser}&select=${archSelect}&notion_id=not.is.null`;
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: srKey,
        Authorization: `Bearer ${srKey}`,
        Accept: "application/json",
        Range: `${start}-${end}`,
      },
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, rows: [], error: text.slice(0, 400) };
    }
    let rows;
    try {
      rows = JSON.parse(text);
    } catch {
      return { ok: false, rows: [], error: "Invalid JSON from Supabase" };
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { ok: true, rows: all };
}

/**
 * Mark trades archived when their notion_id is not in the current OAuth-mapped Notion database.
 * Requires service role + `schema/trade_source_archive.sql` (archived column).
 */
async function reconcileTradesArchiveForOAuthUser(userId, dryRun) {
  const ctx = await notionOAuthFetchAllPages(userId);
  if (ctx.skipped) {
    return { ok: false, reason: ctx.reason, skipped: true };
  }
  if (!ctx.ok) {
    return {
      ok: false,
      reason: ctx.reason,
      oauthAuthError: ctx.oauthAuthError,
      status: ctx.status,
    };
  }
  const liveIds = (ctx.pages ?? []).map((p) => p?.id).filter(Boolean);
  if (liveIds.length === 0) {
    return { ok: false, reason: "empty_notion_database" };
  }

  const live = new Set(liveIds);
  const { url, tableRaw } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) {
    return { ok: false, reason: "Supabase not configured" };
  }
  if (!TRADE_ARCHIVED_ACTIVE) {
    return {
      ok: false,
      reason: "Set SKIP_TRADE_ARCHIVED_FILTER unset and run schema/trade_source_archive.sql before reconcile.",
    };
  }

  const tableEnc = encodeURIComponent(tableRaw);
  const { ok, rows, error } = await fetchTradeRowsNotionIdArchived(url, tableEnc, srKey, userId);
  if (!ok) {
    return { ok: false, reason: error || "fetch_trades_failed" };
  }

  const toArchive = [];
  const toUnarchive = [];
  for (const row of rows) {
    const nid = row.notion_id;
    if (!nid) continue;
    const isLive = live.has(nid);
    const ar = row.archived === true;
    if (isLive && ar) toUnarchive.push(nid);
    if (!isLive && !ar) toArchive.push(nid);
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      live_notion_pages: liveIds.length,
      trades_with_notion_id: rows.length,
      would_archive: toArchive.length,
      would_unarchive: toUnarchive.length,
    };
  }

  const a1 = await patchTradesArchivedByNotionIds(url, tableEnc, srKey, userId, toArchive, true);
  if (!a1.ok) return { ok: false, reason: `archive_patch: ${a1.error}` };
  const a2 = await patchTradesArchivedByNotionIds(url, tableEnc, srKey, userId, toUnarchive, false);
  if (!a2.ok) return { ok: false, reason: `unarchive_patch: ${a2.error}` };

  return {
    ok: true,
    live_notion_pages: liveIds.length,
    archived: toArchive.length,
    unarchived: toUnarchive.length,
  };
}

async function handleNotionReconcileArchive(req, res) {
  const expected = process.env.JARVIS_RECONCILE_SECRET?.trim();
  if (!expected) {
    json(res, 503, {
      error:
        "JARVIS_RECONCILE_SECRET is not set. Add it to .env / Vercel to enable POST /api/notion/reconcile-archive.",
    });
    return;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }
  if (body.secret !== expected) {
    json(res, 403, { error: "Invalid secret" });
    return;
  }
  const user_id = body.user_id;
  if (!user_id || typeof user_id !== "string") {
    json(res, 400, { error: "user_id required" });
    return;
  }
  const dry_run = Boolean(body.dry_run);
  try {
    const result = await reconcileTradesArchiveForOAuthUser(user_id, dry_run);
    if (result.skipped) {
      json(res, 400, { error: result.reason || "OAuth mapping not available" });
      return;
    }
    if (!result.ok) {
      json(res, 502, { error: result.reason || "reconcile_failed" });
      return;
    }
    json(res, 200, result);
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * OAuth + notion_mappings → trades (shared by POST /api/notion/sync-user and maybeSyncNotion).
 * Notion OAuth access tokens are not refreshed here (schema has no refresh_token); reconnect if Notion invalidates the token.
 *
 * @returns { skipped: true, reason: 'no_connection'|'no_mapping' }
 * @returns { ok: true, fetched, upserted, skipped: false }
 * @returns { ok: false, skipped: false, reason, oauthAuthError?, status? }
 */
async function syncNotionOAuthForUser(userId) {
  const syncStart = Date.now();
  const { url, tableRaw } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) {
    console.log("[NOTION-SYNC] abort: Supabase not configured user=%s", userId);
    return { ok: false, skipped: false, reason: "Supabase not configured" };
  }

  console.log("[NOTION-SYNC] start user=%s", userId);

  const ctx = await notionOAuthFetchAllPages(userId);
  if (ctx.skipped) {
    console.log("[NOTION-SYNC] skipped user=%s reason=%s", userId, ctx.reason);
    return { skipped: true, reason: ctx.reason };
  }
  if (!ctx.ok) {
    console.log("[NOTION-SYNC] fetch-failed user=%s reason=%s", userId, ctx.reason);
    return {
      ok: false,
      skipped: false,
      reason: ctx.reason,
      oauthAuthError: ctx.oauthAuthError,
      status: ctx.status,
    };
  }

  const allPages = ctx.pages;
  const mapping = ctx.mapping;
  const accessToken = ctx.accessToken;
  const dbId = ctx.databaseId ?? "(unknown)";
  console.log("[NOTION-SYNC] fetched pages=%d db=%s user=%s mapping_keys=%s",
    allPages.length, dbId, userId, Object.keys(mapping).filter(k => !k.startsWith("__")).join(","));

  // Layer 1: workspace-wide cache (fast path — finds all shared supporting DBs)
  const lookupCache = await buildRelationLookupCache(accessToken, dbId);

  // Layer 2: lazy per-ID fetch for any relation IDs not resolved by workspace search
  const allRelationIds = collectRelationIds(allPages);
  const lazyStats = await lazyFetchRelationPages(accessToken, lookupCache, allRelationIds);
  console.log("[NOTION-SYNC] relation-cache: workspace=%d lazy-added=%d lazy-failed=%d total=%d user=%s",
    lookupCache.size - lazyStats.fetched, lazyStats.fetched, lazyStats.failed, lookupCache.size, userId);

  const tableEnc = encodeURIComponent(tableRaw);
  const batch = [];
  const batchPages = [];
  let skippedCount = 0;
  const skippedReasons = {};
  let sampleLogged = false;

  for (const page of allPages) {
    const props = page.properties ?? {};
    const get = (field) => mapping[field] ? notionGetPropResolved(props, mapping[field], lookupCache) : "";

    // Date: use meta resolver that preserves time when Notion provides it
    const legacyGet = (field) => notionGetProp(props, mapping[field]);
    const dateResult = resolveNotionTradeDateWithMeta(page, mapping, legacyGet);

    // Pair: semantic resolver with relation resolution + instrument pattern fallback
    const pairVal = resolveOAuthPair(props, mapping, lookupCache);

    if (!dateResult && !pairVal) {
      skippedCount++;
      const reason = "no_date_and_no_pair";
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
      console.log("[NOTION-SYNC] skip page=%s reason=%s", page.id, reason);
      continue;
    }

    const resolvedDate = dateResult ? dateResult.iso : new Date().toISOString().slice(0, 10);
    const hasTime = dateResult ? dateResult.hasTime : false;

    // RR: semantic resolver with formula/text fallbacks
    const rrClean = (() => {
      const n = resolveOAuthRR(props, mapping);
      if (n == null) return null;
      const parsed = typeof n === "number" ? n : Number(String(n).replace(/[^0-9.\-]/g, ""));
      return !isNaN(parsed) ? parsed : null;
    })();

    // Outcome: semantic resolver with full fallback chain
    const outcomeVal = resolveOAuthOutcome(props, mapping, lookupCache, rrClean);

    const directionVal = get("direction") || "Not set";
    const sessionVal = get("session") || "";
    const modelVal = get("model") || "";

    // Serialize extras then resolve any remaining UUIDs in relation arrays
    const rawExtras = serializeNotionProperties(props);
    const notionExtras = resolveUuidsInExtras(rawExtras, lookupCache);

    batchPages.push(page);
    batch.push({
      notion_id: page.id,
      auth_user_id: userId,
      user_id: legacyEmailForAuthUserId(userId) || userId,
      date: resolvedDate,
      has_time: hasTime,
      outcome: outcomeVal,
      rr: rrClean,
      session: sessionVal,
      pair: pairVal,
      direction: directionVal,
      notes: get("notes") || null,
      model: modelVal,
      notion_url: page.url ?? null,
      trade_images: [],
      notion_extras: notionExtras,
      notion_sync_source: "oauth",
      archived: false,
      updated_at: new Date().toISOString(),
    });

    // Log first resolved trade for diagnosis
    if (!sampleLogged) {
      sampleLogged = true;
      const pairProp = mapping.pair ? findPropByName(props, mapping.pair) : null;
      const pairRaw = pairProp ? (pairProp.type === "relation"
        ? (pairProp.relation ?? []).map(r => r?.id).join(",")
        : String(notionPropValue(pairProp) ?? "")) : "(no mapping)";
      console.log("[NOTION-SYNC] sample-trade=%s cache-size=%d pair-raw=%s pair-resolved=%s outcome=%s rr=%s",
        page.id, lookupCache.size, pairRaw.slice(0, 40), pairVal, outcomeVal, rrClean);
    }
  }

  console.log("[NOTION-SYNC] mapped rows=%d skipped=%d%s user=%s elapsed=%dms",
    batch.length, skippedCount,
    skippedCount > 0 ? ` (${JSON.stringify(skippedReasons)})` : "",
    userId, Date.now() - syncStart);

  await enrichOAuthSyncTradeImages(accessToken, batch, batchPages, mapping);

  const fetched = allPages.length;

  if (batch.length > 0) {
    const upsertCols =
      "notion_id,auth_user_id,user_id,date,has_time,outcome,rr,session,pair,direction,notes,model,notion_url,trade_images,notion_extras,notion_sync_source,archived,updated_at";
    try {
      let upsertedTotal = 0;
      for (let i = 0; i < batch.length; i += OAUTH_TRADE_UPSERT_BATCH) {
        const slice = batch.slice(i, i + OAUTH_TRADE_UPSERT_BATCH);
        const upsertRes = await fetch(`${url}/rest/v1/${tableEnc}?on_conflict=notion_id&columns=${upsertCols}`, {
          method: "POST",
          headers: {
            apikey: srKey,
            Authorization: `Bearer ${srKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(slice),
        });
        if (!upsertRes.ok) {
          const err = await upsertRes.text().catch(() => "unknown");
          console.log("[NOTION-SYNC] upsert-fail batch_start=%d status=%s err=%s user=%s",
            i, upsertRes.status, err.slice(0, 200), userId);
          return { ok: false, skipped: false, reason: `Trades upsert failed: ${err}` };
        }
        upsertedTotal += slice.length;
        console.log("[NOTION-SYNC] upsert batch_start=%d batch_size=%d ok user=%s", i, slice.length, userId);
      }
    } catch (e) {
      console.log("[NOTION-SYNC] upsert-exception user=%s err=%s", userId, String(e.message ?? e));
      return { ok: false, skipped: false, reason: String(e.message ?? e) };
    }
  }

  const fieldSync = await maybeSyncJournalFieldsFromOAuth(userId);
  const elapsed = Date.now() - syncStart;

  console.log("[NOTION-SYNC] done user=%s fetched=%d upserted=%d skipped=%d elapsed=%dms",
    userId, fetched, batch.length, skippedCount, elapsed);

  return {
    ok: true,
    fetched,
    upserted: batch.length,
    skipped: false,
    journal_fields_synced: fieldSync.ok ? fieldSync.synced ?? 0 : 0,
  };
}

async function handleNotionConnectionStatus(req, res) {
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 200, { connected: false }); return; }
  // notion_connections.user_id stores email, not UUID — use same fallback as other notion handlers
  const emailUserId = legacyEmailForAuthUserId(authUserId) || authUserId;
  try {
    const rows = await fetchNotionUserRows(url, key, "notion_connections", emailUserId, authUserId);
    json(res, 200, { connected: Array.isArray(rows) && rows.length > 0 });
  } catch {
    json(res, 200, { connected: false });
  }
}

async function handleNotionDisconnect(req, res) {
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorized" }); return; }
  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) { json(res, 500, { error: "Supabase not configured" }); return; }

  // Rows may be stored under email or UUID — delete both to guarantee a clean wipe
  const emailUserId = legacyEmailForAuthUserId(authUserId, req.jarvisAuth?.email) || authUserId;
  const userIds = [...new Set([emailUserId, authUserId])];

  try {
    await Promise.all(
      userIds.flatMap((uid) => [
        fetch(`${url}/rest/v1/notion_connections?user_id=eq.${encodeURIComponent(uid)}`, {
          method: "DELETE",
          headers: { apikey: srKey, Authorization: `Bearer ${srKey}`, Prefer: "return=minimal" },
        }),
        fetch(`${url}/rest/v1/notion_mappings?user_id=eq.${encodeURIComponent(uid)}`, {
          method: "DELETE",
          headers: { apikey: srKey, Authorization: `Bearer ${srKey}`, Prefer: "return=minimal" },
        }),
      ])
    );
    notionSyncInflight.delete(authUserId);
    json(res, 200, { success: true });
  } catch (e) {
    json(res, 500, { error: String(e.message ?? e) });
  }
}

async function handleNotionSyncUser(req, res) {
  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const user_id = authUserIdFromReq(req);
  if (!user_id) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }

  const syncMeta = await maybeSyncNotion(user_id, { force: true });

  if (syncMeta.skipped && syncMeta.oauthRequired) {
    // Not an error — user is on the legacy env-var sync path, not OAuth.
    // Return 200 so the frontend doesn't show an error toast.
    json(res, 200, { ok: false, skipped: true, reason: syncMeta.reason || "no_oauth_connection" });
    return;
  }

  if (!syncMeta.ok) {
    json(res, syncMeta.oauthAuthError ? 401 : 502, {
      error: syncMeta.reason || "Sync failed",
    });
    return;
  }

  firePostSyncBrain(user_id);
  json(res, 200, { synced: syncMeta.upserted ?? 0, fetched: syncMeta.fetched ?? null });
}

async function handleUserProfileGet(req, res) {
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) { json(res, 401, { error: "Unauthorised" }); return; }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 500, { error: "Supabase not configured" }); return; }
  try {
    const r = await fetch(
      `${url}/rest/v1/user_profiles?auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1&select=timezone`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    if (!r.ok) { json(res, 502, { error: "Profile fetch failed" }); return; }
    const rows = await r.json().catch(() => null);
    const profile = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    json(res, 200, { timezone: profile?.timezone ?? null });
  } catch (e) {
    json(res, 502, { error: `Profile fetch error: ${String(e.message ?? e)}` });
  }
}

async function handleUserProfile(req, res) {
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) {
    json(res, 401, { error: "Unauthorised" });
    return;
  }

  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch { json(res, 400, { error: "Invalid JSON body" }); return; }

  const ALLOWED_FIELDS = ["trading_style", "markets", "trading_windows", "biggest_struggle", "goals", "timezone", "onboarding_complete", "onboarding_completed_at"];
  const row = { auth_user_id: authUserId, updated_at: new Date().toISOString() };
  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) row[field] = body[field];
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 500, { error: "Supabase not configured" }); return; }

  try {
    const upsertRes = await fetch(`${url}/rest/v1/user_profiles?on_conflict=auth_user_id`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });
    if (!upsertRes.ok) {
      const errText = await upsertRes.text().catch(() => "unknown");
      console.error("[user-profile] upsert failed", upsertRes.status, errText);
      json(res, 502, { error: `Profile upsert failed: ${errText}` }); return;
    }
    json(res, 200, { success: true });
  } catch (e) {
    json(res, 502, { error: `Profile upsert error: ${String(e.message ?? e)}` });
  }
}

async function handleOnboardingState(req, res) {
  const authUserId = authUserIdFromReq(req);
  if (!authUserId) {
    json(res, 401, { error: "Unauthorised" });
    return;
  }
  // notion_connections and notion_mappings use user_id TEXT (email), not auth_user_id (UUID)
  const emailUserId = legacyEmailForAuthUserId(authUserId) || authUserId;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 500, { error: "Supabase not configured" }); return; }

  let profileRow = null;
  let hasNotionConnection = false;
  let hasNotionMapping = false;

  try {
    const [profileRes, notionConnRows, notionMapRows] = await Promise.all([
      fetch(`${url}/rest/v1/user_profiles?auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      }),
      fetchNotionUserRows(url, key, "notion_connections", emailUserId, authUserId),
      fetchNotionUserRows(url, key, "notion_mappings", emailUserId, authUserId),
    ]);
    const profileRows = await profileRes.json().catch(() => null);
    profileRow = Array.isArray(profileRows) && profileRows.length > 0 ? profileRows[0] : null;
    hasNotionConnection = Array.isArray(notionConnRows) && notionConnRows.length > 0;
    hasNotionMapping = Array.isArray(notionMapRows) && notionMapRows.length > 0;
  } catch (e) {
    json(res, 500, { error: `State check failed: ${String(e.message ?? e)}` });
    return;
  }

  // No profile row yet — pick entry point based on Notion state
  if (!profileRow) {
    if (hasNotionMapping) {
      json(res, 200, { step: "profile" });
    } else if (hasNotionConnection) {
      json(res, 200, { step: "mapping" });
    } else {
      json(res, 200, { step: "path-picker" });
    }
    return;
  }

  if (profileRow.onboarding_complete) {
    json(res, 200, { step: "complete" });
    return;
  }

  // Incomplete profile — Notion connected but mapping not yet saved → mapping wizard
  if (hasNotionConnection && !hasNotionMapping) {
    json(res, 200, { step: "mapping" });
    return;
  }

  // No Notion path, or Notion fully mapped — send to quiz
  json(res, 200, { step: "profile" });
}

async function handleJarvisIntro(req, res) {
  try {
    const userId = authUserIdFromReq(req);
    if (!userId) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }

    const { url, key, tableRaw } = getSupabaseConfig();
    const sb = !!(url && key);

    // ── Trade count (prefer count header — no row fetch) ──────────────────
    let tradeCount = 0;
    if (sb) {
      try {
        const countRes = await fetch(
          `${url}/rest/v1/${encodeURIComponent(tableRaw)}?auth_user_id=eq.${encodeURIComponent(userId)}&archived=is.false&select=id`,
          {
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              Prefer: "count=exact",
              "Cache-Control": "no-store",
            },
          }
        );
        const cr = countRes.headers.get("content-range");
        if (cr) {
          const m = cr.match(/\/(\d+)$/);
          if (m) tradeCount = parseInt(m[1], 10) || 0;
        }
      } catch {
        /* best-effort */
      }
    }

    // ── Calibration level ─────────────────────────────────────────────────
    let calibration_level;
    if (tradeCount === 0) calibration_level = "none";
    else if (tradeCount < 15) calibration_level = "watching";
    else if (tradeCount < 30) calibration_level = "early";
    else if (tradeCount < 50) calibration_level = "calibrated";
    else calibration_level = "full";

    // ── Intelligence file (read only — never trigger generation here) ─────
    let intel = null;
    if (sb) {
      try {
        const intelRes = await fetch(
          `${url}/rest/v1/intelligence_files?auth_user_id=eq.${encodeURIComponent(userId)}&select=report&limit=1`,
          {
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Cache-Control": "no-store",
            },
          }
        );
        if (intelRes.ok) {
          const rows = await intelRes.json();
          if (Array.isArray(rows) && rows[0]?.report) intel = rows[0].report;
        }
      } catch {
        /* best-effort */
      }
    }

    // ── Derived fields ────────────────────────────────────────────────────
    const win_rate =
      typeof intel?.performance?.winRateRaw === "number"
        ? Math.round(intel.performance.winRateRaw * 1000) / 10
        : null;

    const best_setup =
      (typeof intel?.edgeMap?.strongestEdge === "string" && intel.edgeMap.strongestEdge) ||
      intel?.edgeMap?.bestModel?.name ||
      null;

    const top_observations = [];
    if (intel) {
      if (intel.form?.summary && intel.form.summary !== "No streak data available.") {
        top_observations.push(intel.form.summary);
      }
      if (intel.edgeMap?.bestModel?.name) {
        top_observations.push(
          `Your strongest model is ${intel.edgeMap.bestModel.name} at ${intel.edgeMap.bestModel.winRate} win rate`
        );
      }
      if (typeof intel.leaks?.biggestLeak === "string" && intel.leaks.biggestLeak) {
        top_observations.push(intel.leaks.biggestLeak);
      }
    }

    json(res, 200, {
      trade_count: tradeCount,
      win_rate,
      best_setup,
      top_observations: top_observations.slice(0, 3),
      calibration_level,
    });
  } catch (e) {
    console.error("[jarvis-intro]", e);
    json(res, 200, {
      trade_count: 0,
      win_rate: null,
      best_setup: null,
      top_observations: [],
      calibration_level: "none",
    });
  }
}

const server = http.createServer(requestListener);

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Trading journal: http://localhost:${PORT}`);
    console.log(
      `[livereload] Edit files under public/ — the browser will auto-refresh when you save (local dev only).`
    );
    startPublicFolderWatcher();
    console.log(`Trades API: GET http://localhost:${PORT}/api/trades (Supabase)`);
    console.log(`Notion sync: GET http://localhost:${PORT}/api/sync-notion`);
    console.log(`Briefing API: POST http://localhost:${PORT}/api/briefing`);
    console.log(`Chat API: POST http://localhost:${PORT}/api/chat`);
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      console.warn("[warn] ANTHROPIC_API_KEY is not set. Add it to .env next to server.mjs.");
    }
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      console.warn(
        "[warn] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not fully set — /api/trades will fail until configured."
      );
    }

    void (async () => {
      for (const uid of OAUTH_BOOT_AUTH_USER_IDS) {
        try {
          const r = await maybeSyncNotion(uid, { force: true });
          if (r.ok && !r.skipped) {
            console.log(
              `[notion-sync] Startup OAuth sync ${uid}: fetched ${r.fetched}, upserted ${r.upserted}`
            );
            firePostSyncBrain(uid);
          } else if (r.skipped && r.oauthRequired) {
            console.log(`[notion-sync] Startup skip ${uid}: ${r.reason}`);
          } else if (!r.ok) {
            console.warn(`[notion-sync] Startup ${uid}: ${r.reason || "failed"}`);
          }
        } catch (e) {
          console.error(
            `[notion-sync] Startup OAuth sync failed (${uid}):`,
            e instanceof Error ? e.message : e
          );
        }
      }
    })();
  });
}

export default requestListener;
