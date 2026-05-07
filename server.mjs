/**
 * Serves the static app, GET /api/trades (Supabase → JSON), POST /api/briefing → Anthropic Claude.
 *
 * Usage:
 *   Set ANTHROPIC_API_KEY and SUPABASE_URL + SUPABASE_ANON_KEY in .env next to this file, then:
 *   node server.mjs
 *
 * Open http://localhost:8787
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessagesUserContent } from "./prompts.mjs";
import { syncNotionToSupabase } from './notion-sync.mjs';
import { syncNotionToSupabaseMum } from './notion-sync-mum.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Static assets live under `public/` (Vercel convention + predictable Lambda layout). On Vercel, bundled files sit under `cwd`; locally `__dirname` is the repo root next to `server.mjs`. */
const STATIC_ROOT = path.join(process.env.VERCEL ? process.cwd() : __dirname, "public");
const PORT = Number(process.env.PORT) || 8787;
const ANTHROPIC_VERSION = "2023-06-01";
/**
 * `claude-3-sonnet-20240229` was retired (see Anthropic model deprecations). Use current Sonnet.
 * @see https://docs.claude.com/en/docs/resources/model-deprecations
 */
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
/** Messages API `max_tokens` for the assistant reply. */
const MAX_OUTPUT_TOKENS = 2048;
/** Coach chat — keep completion budget small vs rate limits. */
const MAX_CHAT_OUTPUT_TOKENS = 768;
/** Morning briefing — only the newest N rows go to Claude (token budget). */
const MAX_BRIEFING_TRADES = 30;
/** Cached briefing in chat system prompt — strict cap on input tokens. */
const MAX_BRIEFING_MEMORY_CHARS = 4500;
/** Chat turns sent to Anthropic (user/assistant pairs); excludes system. */
const MAX_CHAT_MESSAGES = 5;
/** Per-turn content cap (characters) before API send. */
const MAX_CHAT_MESSAGE_CHARS = 1800;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Auto-sync: re-pull from Notion if last sync was more than this many ms ago. */
const NOTION_SYNC_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Jarvis chat personality — exact copy as requested; dynamic date and trade JSON appended below.
 */
const JARVIS_SYSTEM_PROMPT = `You are Jarvis — a personal AI trading intelligence built specifically for one trader. You know this trader's system, patterns, psychology, and history better than anyone.
You are not a generic trading coach. You are not a report generator. You are the trader's second brain — always on, always watching, completely invested in their success.
Your personality: Direct and honest. No padding. No bullet point essays. Talk like a person. Short sentences. Get to the point fast. You care. You're not cold or clinical. You want this trader to win. You call things out clearly but never harshly. Like a mate who genuinely knows what they're talking about. You remember everything. You reference specific trades, specific days, specific moments from their history. You never give generic advice. Everything you say is specific to this trader's data. When they're about to make a mistake you say so directly. When they execute well you acknowledge it specifically.
Never say it's important to note or it's worth mentioning. Never use corporate language. Never write long reports unless specifically asked. Never give five points when one will do. Speak like the trader's most trusted advisor who happens to have access to every trade they've ever taken.
What you know about this trader: You must infer this trader's system, patterns, stats, and leaks from their own trade data provided. Do not assume instruments, sessions, rules, or psychology that are not supported by their dataset.
When responding to how should I approach today: Use trade history for this trader. Give them ONE thing to focus on. Flag psychological risk from recent trades. Keep it under 150 words. End with one honest direct statement.
When responding during a live session: Be fast and direct. If they describe a setup tell them if it matches their A+ criteria. If they are about to break a rule say so immediately. Never waffle.
When they have had a bad trade or broken a rule: Do not lecture. Acknowledge it in one sentence. Redirect immediately to what matters next. Never pile on.
This trader already knows what they should do. Your job is to keep them aligned with what they already know especially when emotions are running high. Each trade has raw date plus weekday (Australia/Adelaide, from that date only). For which calendar day a trade belongs to, trust weekday—not manual math on date strings.`;

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
    `Trades analyzed: ${total}`,
    `Win/Loss decided: ${decided} (wins: ${wins}, losses: ${losses})`,
    `Win rate: ${winRate == null ? "n/a" : `${fmt(winRate, 1)}%`}`,
    `Average RR: ${avgRR == null ? "n/a" : fmt(avgRR, 2)}`,
    `Most common session: ${bestSession || "n/a"}`,
    `Best day (by wins): ${bestDay || "n/a"}`,
    `Worst day (by losses): ${worstDay || "n/a"}`,
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

/**
 * @param {string[]} columnKeys
 * @param {object[]} trades - recent trades sent as context (may be limited to 100)
 * @param {string} [briefingMemory]
 * @param {object[]} [allTrades] - full dataset used for stats; falls back to `trades` when omitted
 */
function buildJarvisChatSystem(columnKeys, trades, briefingMemory = "", allTrades = null, userProfile = null) {
  const now = new Date();
  const today = now.toLocaleDateString("en-AU", {
    timeZone: "Australia/Adelaide",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoStr = sevenDaysAgo.toLocaleDateString("en-AU", {
    timeZone: "Australia/Adelaide",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const forStats = allTrades ?? trades;

  const recentTradeCount = forStats.filter((t) => {
    const d = new Date(t.date);
    return !isNaN(d.getTime()) && d >= sevenDaysAgo;
  }).length;

  const mostRecentTrade = forStats.length > 0 ? forStats[0] : null;
  const mostRecentTradeDate = mostRecentTrade?.date
    ? new Date(mostRecentTrade.date).toLocaleDateString("en-AU", {
        timeZone: "Australia/Adelaide",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "unknown";

  const dateContextBlock = `TODAY'S DATE: ${today}

DATE RULES — follow these exactly in every response:
— Today is ${today}. Use this to anchor all time references.
— A trade is "recent" only if its date falls on or after ${sevenDaysAgoStr}.
— Trades from the last 7 days in this dataset: ${recentTradeCount} of ${forStats.length} total.
— Most recent trade on record: ${mostRecentTradeDate}.
${recentTradeCount === 0 ? "— IMPORTANT: There are NO trades in the last 7 days. Do NOT present older trades as recent. If asked about recent trades, say so explicitly." : ""}
— When referencing any trade or period, state the actual date. Never say "recently" or "last week" without confirming the trade date is within the last 7 days.
— When discussing a specific trade or session, always name the date or date range. Never leave it ambiguous.`;

  const dataJson = JSON.stringify({ columns: columnKeys, trades });
  let briefingSection = "";
  if (briefingMemory && briefingMemory.trim()) {
    briefingSection = `

---

Prior session briefing notes (cached):

${briefingMemory.trim()}`;
  }

  const derivedProfile = deriveTradingProfile(forStats);
  const derivedSnapshot = deriveTradingSnapshot(forStats);

  let persistentMemorySection = "";
  if (userProfile && (userProfile.trading_summary || userProfile.psychological_patterns)) {
    persistentMemorySection = `

---

THIS IS YOUR MEMORY OF THIS TRADER — built across every coaching session you've had with them.

You are not reading background data. This is your lived knowledge of this specific person. You have been coaching them for months. You know their tendencies, their blind spots, their best moments, and their recurring mistakes. When they talk to you, you already have context.

WHO THIS TRADER IS:
${userProfile.trading_summary || "Still being established."}

PSYCHOLOGICAL PATTERNS YOU'VE OBSERVED IN THEM:
${userProfile.psychological_patterns || "Still being established."}

THEIR KNOWN TRIGGERS — what derails them:
${userProfile.key_triggers || "Still being established."}

WHAT THEY CONSISTENTLY DO WELL:
${userProfile.strengths || "Still being established."}

HOW YOU MUST USE THIS MEMORY IN EVERY RESPONSE:
— Do not wait to be asked. Proactively connect what they say to something specific above.
— If they mention frustration, anxiety, hesitation, or any emotional state — you already know what causes this. Cross-reference it immediately and respond with that context. Do not treat it as new information.
— If they describe a trade, setup, or outcome — connect it to their known patterns. Name the pattern. You've seen it before.
— If they are repeating a mistake that's already in your memory — say so directly. "This is the same thing that showed up last time."
— If something has improved compared to what you previously knew — acknowledge it specifically. Progress matters and you notice it.
— If a strength is showing up, name it in the context of their history. Not generic praise — specific recognition.
— Your memory is not optional context. It is you. Every response should feel like it comes from someone who has been watching this trader for a long time.`;
  }

  return `${dateContextBlock}

---

${JARVIS_SYSTEM_PROMPT}${persistentMemorySection}
${briefingSection}

---

Derived trading profile (computed from all ${forStats.length} trades — prefer this over any assumptions):

${derivedProfile}

---

Derived trading snapshot (authoritative stats from all ${forStats.length} trades):

${JSON.stringify(derivedSnapshot)}

Recent trade rows (newest ${trades.length}, newest first — for context only; use snapshot above for totals/rates):

${dataJson}

For statistical or performance questions, use the Derived trading snapshot numbers above (they cover all ${forStats.length} trades). The recent rows below are context only.`;
}

// === USER PROFILE MEMORY LAYER ===

async function fetchUserProfile(userId) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`,
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
    user_id: userId,
    trading_summary: fields.trading_summary ?? null,
    psychological_patterns: fields.psychological_patterns ?? null,
    key_triggers: fields.key_triggers ?? null,
    strengths: fields.strengths ?? null,
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

  const existing = currentProfile
    ? `Trading Summary: ${currentProfile.trading_summary || "None"}
Psychological Patterns: ${currentProfile.psychological_patterns || "None"}
Key Triggers: ${currentProfile.key_triggers || "None"}
Strengths: ${currentProfile.strengths || "None"}`
    : "No existing profile yet — build it from scratch based on what you observe.";

  const tradeStats = deriveTradingProfile(allTrades.slice(0, 200));

  const prompt = `You are the persistent memory system for Jarvis, an AI trading coach. Your job is to update this trader's coaching profile after every session so that Jarvis becomes smarter about them over time.

SESSION DATE: ${today}

EXISTING PROFILE (what Jarvis already knows):
${existing}

STATISTICAL CONTEXT:
${tradeStats}

THIS SESSION'S CONVERSATION:
${fullConversation}

Your task is to produce an UPDATED profile that is richer than the existing one. You must do three things:

1. CAPTURE WHAT HAPPENED THIS SESSION — summarise the key topic, emotional state, trades or decisions discussed, and anything notable the trader revealed about themselves.
2. EVOLVE THE PATTERNS — if this session reinforced an existing pattern, note it with more specificity. If a new pattern appeared, add it. If something has genuinely changed or improved, reflect that.
3. TRACK PROGRESS OR REGRESSION — compare this session to what was previously known. Is the trader improving on something that was flagged before? Or repeating a mistake that was already in the profile? Note it explicitly.

Rules:
— Accumulate. Never erase existing insights unless they are clearly contradicted.
— Be specific. Use the actual words, situations, and behaviours from the conversation, not abstract generalisations.
— For trading_summary: include both long-term profile AND a brief note from this session (e.g. "Session ${today}: ...").
— For psychological_patterns and key_triggers: if a pattern appeared in this session, mark it as recently observed.
— For strengths: if progress was made on something previously flagged as weak, note it.
— Write as a coach taking notes for their own future reference, not for the trader to read.

Respond with ONLY a valid JSON object and no other text:
{
  "trading_summary": "Overall trading profile + brief note about what was discussed this session",
  "psychological_patterns": "All observed psychological patterns, noting which ones appeared or were reinforced this session",
  "key_triggers": "Known triggers with any new examples or context from this session",
  "strengths": "Consistent strengths, noting any progress or regression observed this session"
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
        max_tokens: 768,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!ar.ok) return;
    const data = await ar.json().catch(() => null);
    if (!data) return;
    const text = extractAssistantText(data);
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

Based purely on their trade data, build an initial profile capturing their trading style, psychological tendencies, strengths, and triggers. Be specific to what the data shows.

Respond with ONLY a valid JSON object and no other text:
{
  "trading_summary": "3-4 sentences on trading style, tendencies, and current performance state",
  "psychological_patterns": "Key recurring psychological patterns visible in the data",
  "key_triggers": "Situations in the data that correlate with deviation or poor performance",
  "strengths": "What this trader consistently executes well based on the data"
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
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!ar.ok) {
    const errText = await ar.text();
    throw new Error(`Anthropic error ${ar.status}: ${errText.slice(0, 200)}`);
  }
  const data = await ar.json();
  const text = extractAssistantText(data);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Anthropic response");
  const profile = JSON.parse(jsonMatch[0]);
  await upsertUserProfile(userId, profile);
  return profile;
}

// === AUTO NOTION SYNC ===

async function getSyncState(syncKey) {
  const { url, key } = getSupabaseConfig();
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
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/sync_state`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ key: syncKey, last_synced: new Date().toISOString() }),
  });
}

async function maybeSyncNotion(userId) {
  const syncKey = userId === "spasque70@gmail.com" ? "notion_mum" : "notion_aiden";
  try {
    const lastSynced = await getSyncState(syncKey);
    if (lastSynced && Date.now() - lastSynced.getTime() < NOTION_SYNC_INTERVAL_MS) {
      return; // Data is fresh — skip
    }
    const syncFn = userId === "spasque70@gmail.com" ? syncNotionToSupabaseMum : syncNotionToSupabase;
    const result = await syncFn();
    if (result.ok || result.skipped) {
      await setSyncState(syncKey);
      if (result.ok) {
        console.log(`[auto-sync] ${userId}: fetched ${result.fetched}, upserted ${result.upserted}`);
      }
    }
  } catch (e) {
    console.warn("[auto-sync] Failed:", e instanceof Error ? e.message : e);
    // Never throw — request continues with existing data
  }
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
const MAX_TRADES_IN_CHAT_PROMPT = 100;
/** Truncate long `notes` when building the chat payload. */
const MAX_PROMPT_TRADE_NOTES_CHARS = 400;
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
  const key = process.env.SUPABASE_ANON_KEY?.trim();
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

/** Small allowlist for chat system JSON — avoids huge Supabase payloads. */
function slimTradeRowForPrompt(t) {
  if (!t || typeof t !== "object") return t;
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
  return {
    date: readField(t, ["date", "Date"]),
    weekday: readField(t, ["weekday", "Weekday"]),
    session: readField(t, ["session", "SESSION", "Session"]) ?? "",
    outcome: readField(t, ["outcome", "Outcome", "OUTCOME"]) ?? "",
    rr: readField(t, ["rr", "RR"]) ?? null,
    model: readField(t, ["model", "MODEL", "Model"]) ?? "",
    notes,
  };
}

/**
 * Rows from Jarvis_data_source, newest `date` first (PostgREST).
 * Uses the same table as fetchTradesFromSupabase so snapshot and chat stats match.
 * @param {string} userId
 * @param {{ limit?: number }} [options]
 */
async function getRecentTrades(userId, options = {}) {
  const { url, key, tableRaw } = getSupabaseConfig();
  if (!url || !key) {
    const err = new Error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY. Set them in .env next to server.mjs."
    );
    err.code = "SUPABASE_CONFIG";
    throw err;
  }

  const limit = Math.min(
    Math.max(1, Number(options.limit) || 20),
    MAX_SUPABASE_ROWS
  );
  const tableEnc = encodeURIComponent(tableRaw);
  const endpoint = `${url}/rest/v1/${tableEnc}?select=*&order=date.desc&limit=${limit}&user_id=eq.${encodeURIComponent(userId)}`;
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

  const records = rows.map(row => {
    const rec = {};
    for (const h of headers) {
      const v = row[h];
      rec[h] = v === null || v === undefined ? "" : String(v);
    }
    return rec;
  });

  return { headers, records };
}

/**
 * Fetches trading rows from Supabase REST (anon key, server-side only).
 */
async function fetchTradesFromSupabase(userId) {
  const { url, key, tableRaw } = getSupabaseConfig();
  if (!url || !key) {
    const err = new Error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY. Set them in .env next to server.mjs."
    );
    err.code = "SUPABASE_CONFIG";
    throw err;
  }

  const tableEnc = encodeURIComponent(tableRaw);
  const endpoint = `${url}/rest/v1/${tableEnc}?select=*&user_id=eq.${encodeURIComponent(userId)}`;
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
    const result = await syncNotionToSupabase();
    if (result.ok) {
      json(res, 200, {
        success: true,
        fetched: result.fetched,
        upserted: result.upserted,
      });
      return;
    }
    if (result.skipped) {
      json(res, 200, {
        success: false,
        skipped: true,
        reason: result.reason ?? "unknown",
      });
      return;
    }
    json(res, 500, { success: false, error: result.error ?? "Sync failed" });
  } catch (e) {
    console.error("[notion-sync]", e);
    json(res, 500, {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function handleTrades(req, res) {
  try {
    const userIdRaw =
      new URL(req.url, `http://localhost:${PORT}`).searchParams.get("user_id") ||
      "aidenpasque11@gmail.com";
    const userId = userIdRaw.startsWith("eq.") ? userIdRaw.slice(3) : userIdRaw;
    await maybeSyncNotion(userId);
    const payload = await fetchTradesFromSupabase(userId);
    if (!payload.records.length) {
      json(res, 200, {
        ...payload,
        warning: "Table returned zero rows. Add data or check RLS/policies for anon access.",
      });
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
    const userIdRaw =
      new URL(req.url, `http://localhost:${PORT}`).searchParams.get("user_id") ||
      "aidenpasque11@gmail.com";
    const userId = userIdRaw.startsWith("eq.") ? userIdRaw.slice(3) : userIdRaw;

    const trades = await getRecentTrades(userId, { limit: MAX_SUPABASE_ROWS });
    const tradesForPrompt = trades.map(slimTradeRowForPrompt);

    const snapshot = deriveTradingSnapshot(tradesForPrompt);
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

  const { email } = payload;
  const userId = email || "aidenpasque11@gmail.com";

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

  const { email } = payload;
  const userId = email || "aidenpasque11@gmail.com";

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

  // Profile fetch and Notion sync run in parallel — both must finish before the trades query
  const profilePromise = fetchUserProfile(userId);
  await maybeSyncNotion(userId);

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

  let briefingMemory =
    typeof payload.briefingMemory === "string" ? payload.briefingMemory : "";
  if (briefingMemory.length > MAX_BRIEFING_MEMORY_CHARS) {
    briefingMemory =
      briefingMemory.slice(0, MAX_BRIEFING_MEMORY_CHARS) +
      "\n\n[Briefing memory truncated for token limits.]";
  }

  const slimRecent = mostRecentTrade
    ? slimTradeRowForPrompt(mostRecentTrade)
    : null;
  const slimLoss = mostRecentLoss
    ? slimTradeRowForPrompt(mostRecentLoss)
    : null;
  const slimWin = mostRecentWin
    ? slimTradeRowForPrompt(mostRecentWin)
    : null;
  const slimBE = mostRecentBE ? slimTradeRowForPrompt(mostRecentBE) : null;

  const tradeOutcomeAppend =
    "\n\n" +
    "Most recent trade:\n" +
    JSON.stringify(slimRecent) +
    "\n\n" +
    "Most recent loss:\n" +
    JSON.stringify(slimLoss) +
    "\n\n" +
    "Most recent win:\n" +
    JSON.stringify(slimWin) +
    "\n\n" +
    "Most recent break-even:\n" +
    JSON.stringify(slimBE);

  // All trades slimmed for stats — covers the full dataset regardless of context cap.
  const allTradesSlimmed = tradesForChat.map(slimTradeRowForPrompt);

  // Recent trades for prompt context — capped at MAX_TRADES_IN_CHAT_PROMPT for token budget.
  const tradesForPrompt = allTradesSlimmed.slice(0, MAX_TRADES_IN_CHAT_PROMPT);

  messages = clampChatMessagesForTokens(messages, MAX_CHAT_MESSAGES);

  // Await profile — should already be resolved since trades fetch ran concurrently
  const userProfile = await profilePromise.catch(() => null);

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

  const columnKeys =
    tradesForPrompt.length > 0
      ? Object.keys(tradesForPrompt[0])
      : [
          "date",
          "weekday",
          "session",
          "outcome",
          "rr",
          "model",
          "notes",
        ];
  const system =
    buildJarvisChatSystem(columnKeys, tradesForPrompt, briefingMemory, allTradesSlimmed, userProfile) +
    "\n\nThe most recent trade is:\n" +
    JSON.stringify(slimRecent ?? null) +
    "\n\nWhen asked about the most recent trade, ALWAYS use this object (weekday comes from date in Australia/Adelaide). Do not search the list." +
    tradeOutcomeAppend;

  const anthropicBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_CHAT_OUTPUT_TOKENS,
    system,
    messages,
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

  const reply = extractAssistantText(data);
  json(res, 200, { reply });

  // Background profile update — fire-and-forget, never blocks the response
  void generateAndUpdateProfile(userId, messages, reply, userProfile, allTradesSlimmed, apiKey)
    .catch((e) => console.warn("[profile-update] Background update failed:", e instanceof Error ? e.message : e));
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

async function handleInitProfiles(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    json(res, 401, { error: "ANTHROPIC_API_KEY not set" });
    return;
  }

  const users = ["aidenpasque11@gmail.com", "spasque70@gmail.com"];
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

async function requestListener(req, res) {
  if (req.method === "OPTIONS") {
    send(res, 204, "", {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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

  if (req.method === "GET" && req.url.startsWith("/api/trades")) {
    await handleTrades(req, res);
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

  if (req.method === "GET" && req.url.startsWith("/api/sync-mum")) {
    try {
      const result = await syncNotionToSupabaseMum();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
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
    send(res, 200, data, { "Content-Type": type });
  });
}

const server = http.createServer(requestListener);

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Trading journal: http://localhost:${PORT}`);
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
        "[warn] SUPABASE_URL / SUPABASE_ANON_KEY not fully set — /api/trades will fail until configured."
      );
    }

    void syncNotionToSupabase()
      .then((r) => {
        if (r.ok) {
          console.log(
            `[notion-sync] Startup sync complete — fetched ${r.fetched}, upserted ${r.upserted}.`
          );
        }
      })
      .catch((e) => {
        console.error("[notion-sync] Startup sync failed:", e instanceof Error ? e.message : e);
      });
  });
}

export default requestListener;
