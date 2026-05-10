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
— When discussing a specific trade or session, always name the date or date range. Never leave it ambiguous.
— IMPORTANT: The raw "date" field in every trade row is stored in UTC. The "date_local" field is the correct Adelaide local time (Australia/Adelaide, GMT+10:30). ALWAYS use "date_local" when telling the trader what time or date a trade occurred. Never read the time from the "date" field.`;

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

Your task is to produce an UPDATED profile that is richer than the existing one. You must do three things:

1. CAPTURE WHAT HAPPENED THIS SESSION — summarise the key topic, emotional state, trades or decisions discussed, and anything notable the trader revealed about themselves.
2. EVOLVE THE PATTERNS — if this session reinforced an existing pattern, note it with more specificity. If a new pattern appeared, add it. If something has genuinely changed or improved, reflect that.
3. TRACK PROGRESS OR REGRESSION — compare this session to what was previously known. Is the trader improving on something that was flagged before? Or repeating a mistake that was already in the profile? Note it explicitly.

Rules:
— Accumulate. Never erase existing insights unless they are clearly contradicted.
— Be specific. Use the actual words, situations, and behaviours from the conversation, not abstract generalisations.
— Include dates where relevant. Prefer the trade's date_local string (Australia/Adelaide).
— Include instruments/setups where relevant. If you mention a trade event, include pair + entry model when available.
— Avoid vague labels. Do not write "revenge trading" / "tilt" / "overtrading" unless you anchor it to a concrete example with a date (and pair/model if available).
— Avoid fuzzy frequency words ("often", "sometimes", "tends to") unless you add either a count or an example date.
— Output formatting matters: each field must be 5–8 SHORT LINES max.
— Use this exact line style inside each field string:
   - "• " prefix per line (bullet), newline separated (\n).
   - Each line should include at least ONE of: date_local, pair, model, or an explicit count.
— Keep it concise: coach-notes style. No essays.
— For trading_summary: include both long-term profile AND a brief note from this session (e.g. "Session ${today}: ...").
— For psychological_patterns and key_triggers: if a pattern appeared in this session, mark it as recently observed.
— For strengths: if progress was made on something previously flagged as weak, note it.
— Write as a coach taking notes for their own future reference, not for the trader to read.

Respond with ONLY a valid JSON object and no other text:
{
  "trading_summary": "5–8 bullet lines total (\\n separated). Include one line starting with: \\"Session ${today}:\\"",
  "psychological_patterns": "5–8 bullet lines total (\\n separated). Each line anchored to date_local/pair/model or a count.",
  "key_triggers": "5–8 bullet lines total (\\n separated). Each trigger anchored to at least one dated example.",
  "strengths": "5–8 bullet lines total (\\n separated). Anchor strengths to examples or counts; note progress/regression."
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

Based purely on their trade data, build an initial profile capturing their trading style, psychological tendencies, strengths, and triggers.

Rules:
— Be specific. Avoid vague summaries.
— When you claim a psychological pattern/trigger, anchor it to at least one concrete example: include date_local plus instrument (pair) and/or entry model when available.
— If you cannot support something from the data, do not include it.
— Output formatting matters: each field must be 5–8 SHORT LINES max.
— Use this exact line style inside each field string:
   - "• " prefix per line (bullet), newline separated (\n).
   - Each line should include at least ONE of: date_local, pair, model, or an explicit count.
— Keep it concise and coach-notes style.

Respond with ONLY a valid JSON object and no other text:
{
  "trading_summary": "5–8 bullet lines total (\\n separated).",
  "psychological_patterns": "5–8 bullet lines total (\\n separated). Each line anchored to date_local/pair/model or a count.",
  "key_triggers": "5–8 bullet lines total (\\n separated). Each trigger anchored to at least one dated example.",
  "strengths": "5–8 bullet lines total (\\n separated). Anchor strengths to examples or counts."
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
    // Only stamp sync_state after a real successful upsert — never on skipped/failed runs,
    // or the site thinks it is "fresh" while trades never updated.
    if (result.ok) {
      await setSyncState(syncKey);
      console.log(`[auto-sync] ${userId}: fetched ${result.fetched}, upserted ${result.upserted}`);
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
/** Cap screenshot URLs per trade when the user asks for photo links (token budget). */
const MAX_TRADE_IMAGES_IN_CHAT_PROMPT = 12;
/** Max trades that may carry trade_images in one chat prompt (each URL can be huge). */
const MAX_TRADES_WITH_PHOTO_LINKS_IN_CHAT = 12;
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
  const toAdd = [];
  const seen = new Set();

  for (const i of indices) {
    const t = tradesForChat[i];
    if (!t || typeof t !== "object") continue;
    const imgs = normalizeTradeImagesForPrompt(t.trade_images ?? t.Trade_images);
    if (wantsAll) {
      for (const row of imgs) {
        const url = row.url;
        if (!url || seen.has(url)) continue;
        if (base.includes(url)) continue;
        seen.add(url);
        toAdd.push(url);
      }
    } else {
      const first = imgs[0];
      const url = first?.url;
      if (url && !seen.has(url) && !base.includes(url)) {
        seen.add(url);
        toAdd.push(url);
      }
      break;
    }
  }
  if (toAdd.length === 0) return base;
  const trimmed = base.trimEnd();
  const sep = trimmed.length ? "\n\n" : "";
  return `${trimmed}${sep}${toAdd.join("\n")}`;
}

/**
 * True when the user explicitly asks to include/show/link journal photos or charts.
 * Only then do we add `trade_images` to the slim trade JSON (text URLs — not vision).
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

  return false;
}

/**
 * Which rows in `tradesForChat` (newest first) should include `trade_images` URLs.
 * Notion signed URLs are massive — attaching them to every row exceeds model context limits.
 */
function tradePhotoLinkIndices(tradesForChat, messageSource) {
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

  if (indices.size === 0 && arr.length > 0) {
    add(0);
  }

  const sorted = [...indices]
    .sort((a, b) => a - b)
    .slice(0, MAX_TRADES_WITH_PHOTO_LINKS_IN_CHAT);
  return new Set(sorted);
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
    notes,
  };
  if (includeTradeImages) {
    const imgs = normalizeTradeImagesForPrompt(readField(t, ["trade_images", "Trade_images"]));
    if (imgs.length > 0) row.trade_images = imgs;
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
  const endpoint = `${url}/rest/v1/${tableEnc}?select=*&user_id=eq.${encodeURIComponent(userId)}&order=date.desc&limit=${limit}`;
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

  const photoIdxSet = includePhotoLinks
    ? tradePhotoLinkIndices(tradesForChat, messageSource)
    : new Set();
  const slimOptsAt = (i) =>
    includePhotoLinks && photoIdxSet.has(i) ? { includeTradeImages: true } : {};

  if (includePhotoLinks) {
    console.log(
      `[chat] trade photo links — rows with image URLs (0=newest): ${[...photoIdxSet].sort((a, b) => a - b).join(",")}`
    );
  }

  let briefingMemory =
    typeof payload.briefingMemory === "string" ? payload.briefingMemory : "";
  if (briefingMemory.length > MAX_BRIEFING_MEMORY_CHARS) {
    briefingMemory =
      briefingMemory.slice(0, MAX_BRIEFING_MEMORY_CHARS) +
      "\n\n[Briefing memory truncated for token limits.]";
  }

  const ixLoss = mostRecentLoss ? tradesForChat.indexOf(mostRecentLoss) : -1;
  const ixWin = mostRecentWin ? tradesForChat.indexOf(mostRecentWin) : -1;
  const ixBE = mostRecentBE ? tradesForChat.indexOf(mostRecentBE) : -1;

  const slimRecent = mostRecentTrade
    ? slimTradeRowForPrompt(mostRecentTrade, slimOptsAt(0))
    : null;
  const slimLoss = mostRecentLoss
    ? slimTradeRowForPrompt(mostRecentLoss, slimOptsAt(ixLoss))
    : null;
  const slimWin = mostRecentWin
    ? slimTradeRowForPrompt(mostRecentWin, slimOptsAt(ixWin))
    : null;
  const slimBE = mostRecentBE ? slimTradeRowForPrompt(mostRecentBE, slimOptsAt(ixBE)) : null;

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
  const allTradesSlimmed = tradesForChat.map((t, i) =>
    slimTradeRowForPrompt(t, slimOptsAt(i))
  );

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

  let columnKeys =
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
  if (includePhotoLinks && !columnKeys.includes("trade_images")) {
    columnKeys = [...columnKeys, "trade_images"];
  }
  const useWebSearch = needsWebSearch(messageSource);
  console.log(
    `[web-search] ${useWebSearch ? "TRIGGERED" : "not triggered"} — query: "${messageSource.slice(0, 120)}"`
  );

  const system =
    buildJarvisChatSystem(columnKeys, tradesForPrompt, briefingMemory, allTradesSlimmed, userProfile) +
    "\n\nThe most recent trade is:\n" +
    JSON.stringify(slimRecent ?? null) +
    "\n\nWhen asked about the most recent trade, ALWAYS use this object (weekday comes from date in Australia/Adelaide). Do not search the list." +
    tradeOutcomeAppend +
    (useWebSearch
      ? "\n\nYou have a real-time web_search tool available in this conversation. When the user asks about current gold prices, market prices, news, economic events, or any live market data — CALL the web_search tool immediately to look it up before responding. Do not tell the user you have no access to live data; you do have access via web_search."
      : "") +
    (includePhotoLinks
      ? "\n\nTRADE PHOTOS — The user asked to include journal screenshots or charts. Only relevant trades have a \"trade_images\" array below (ordered: \"Trade Photo\" first when labelled; else first image / chart 1). If they ask for a single photo of a trade, paste only one HTTPS URL (that primary chart), not every screenshot. Only if they explicitly ask for all photos, all screenshots, or all charts should you paste multiple URLs. Paste full URLs so the app can render thumbnails—do not claim to see pixels. If there are no trade_images, say no screenshot is stored."
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

async function handleJournalFields(req, res) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }
  const userIdRaw =
    new URL(req.url, `http://localhost:${PORT}`).searchParams.get("user_id") ||
    "aidenpasque11@gmail.com";
  const userId = userIdRaw.startsWith("eq.") ? userIdRaw.slice(3) : userIdRaw;
  try {
    const r = await fetch(
      `${url}/rest/v1/journal_fields?user_id=eq.${encodeURIComponent(userId)}&order=display_order.asc`,
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

async function handleLogTrade(req, res) {
  let raw;
  try { raw = await readBody(req); } catch { json(res, 413, { error: "Payload too large" }); return; }
  let body;
  try { body = JSON.parse(raw); } catch { json(res, 400, { error: "Invalid JSON" }); return; }

  const { url, key: anonKey } = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || anonKey;
  if (!url || !key) { json(res, 503, { error: "Supabase not configured" }); return; }

  const rrVal = body.rr != null && body.rr !== "" ? Number(body.rr) : null;
  const row = {
    user_id: body.user_id || "aidenpasque11@gmail.com",
    traded_at: body.traded_at || new Date().toISOString(),
    pair: body.pair || "XAU/USD",
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
    json(res, 201, { trade: Array.isArray(data) ? data[0] : data });
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

  if (req.method === "GET" && req.url.startsWith("/api/proxy-image")) {
    await handleImageProxy(req, res);
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

  if (req.method === "GET" && req.url.startsWith("/api/journal-fields")) {
    await handleJournalFields(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/log-trade")) {
    await handleLogTrade(req, res);
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
