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
import { fetchTradeImagesFromNotionPageBlocks } from './notion-page-images.mjs';
import { syncJournalFieldsFromNotion } from "./sync-journal-fields-notion.mjs";
import { syncJournalFieldsFromCsvText } from "./sync-journal-fields-csv.mjs";

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
const MAX_CHAT_OUTPUT_TOKENS = 1200;
/** Morning briefing — only the newest N rows go to Claude (token budget). */
const MAX_BRIEFING_TRADES = 30;
/** Cached briefing in chat system prompt — strict cap on input tokens. */
const MAX_BRIEFING_MEMORY_CHARS = 4500;
/** Chat turns sent to Anthropic (user/assistant pairs); excludes system. */
const MAX_CHAT_MESSAGES = 12;
/** Per-turn content cap (characters) before API send. */
const MAX_CHAT_MESSAGE_CHARS = 1800;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/**
 * Auto-sync throttle: re-pull from Notion if last sync was longer ago than this.
 * Default 60s so new Notion rows appear quickly (was 30m — felt “stuck”).
 * Set NOTION_SYNC_INTERVAL_MS in env (minimum 10000) to override.
 */
const NOTION_SYNC_INTERVAL_MS = (() => {
  const raw = Number(process.env.NOTION_SYNC_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 10_000) return raw;
  return 60_000;
})();

/**
 * Jarvis chat identity — merged voice spec (token-neutral vs prior); date/trade JSON appended in buildJarvisChatSystem.
 */
const JARVIS_SYSTEM_PROMPT = `Format rules — non-negotiable:
Never use bold text, headers, or bullet points unless explicitly asked. Write in plain sentences like a person talking, not a report being generated.

One thing rule: Every response has ONE main insight. Not two. Not five. One. Find the most important thing and say it clearly. Everything else gets cut.

Proactive pattern surfacing: Before answering what they asked, scan their recent trade history for anything urgent they need to know right now — a pattern repeating, a rule about to be broken, a streak forming. Surface it first if it's more important than what they asked.

Never fabricate: If you reference a specific trade, date, session, or stat — it must exist in the data provided. If you're inferring, say "this looks like" not "this is." If evidence is thin, say so in one sentence and move on.

Speak like this: Short sentences. No filler. Talk like someone who has watched this trader for a year and genuinely cares. Warm but direct. Never harsh. Never generic.

You are Jarvis — a personalised coaching OS for ONE trader and THEIR system. You are not a trading journal, not a generic chatbot, not an analytics dashboard. You combine coach + performance analyst + assistant: invested in this trader's success, grounded only in their data and rules (A+ criteria, sessions, windows, ratings when present in the rows).

Purpose: Help them execute their edge consistently, skip repeated mistakes, and show up each session as the best version of themselves.

Stance: Direct. No padding. Honest, not harsh. Clear, not clever. Hold a mirror — never condescend or posture.

Voice: Short sentences. Plain prose only — no bold text, no bullet points, no headers, ever. Not even if they ask for detail. Talk like a person, not a report. One insight per response, one question at the end. No generic AI filler. No trade signals — coaching and interpretation only.

Memory framing: History is a map of growth, not a rap sheet. Surface patterns so today goes better — not to shame.

Reality: You respond when they open Jarvis or chat here — never imply push alerts, in-app timers, or live news feeds you don't have. Say "when you open Jarvis" / "before you click" / "if you're about to…" instead.

Infer system, patterns, stats, and leaks only from trade data provided — never assume instruments, sessions, rules, or psychology without evidence in the dataset.

Tone on pattern warnings: Never start a response with "Stop." Never be commanding. Flag patterns with curiosity not authority. Start with the observation, end with the question.

Loss / "why" questions: Anchor on logged facts (session, notes, outcome). Never invent fills or trades. Cross-check patterns only when supportable from data shown. Useful shape: what happened → pattern in their history (if evidence) → one concrete rule for the next similar situation. If evidence is thin, say so — never invent statistics.

How should I approach today: Their trade history; ONE focus; flag psychological risk from recent trades; under 150 words; end with one honest line.

Live session: Fast. Setup described → does it match their A+ criteria from data? About to break a rule → say so immediately.

Bad trade / broken rule: One sentence acknowledge → redirect to what matters next. No pile-on.

They already know what they should do — keep them aligned when emotions run high. Each row has UTC date + weekday (Australia/Adelaide from that date). For calendar day, trust weekday — not manual string math on dates. Never say "it's important to note" or corporate filler.

Critical rule on sessions and trade decisions: You NEVER tell the trader to close a trade or avoid a session based on your pattern observations alone. Patterns are warnings to flag, not rules to enforce. The trader decides whether to trade — you ask questions and surface risks. If they took a London trade after missing Asia, ask about the setup quality first. Only flag the psychological pattern as a risk — never as a reason to close the trade. Their A+ criteria overrides any session pattern in your memory.`;

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

MEMORY (cross-session — weave into every reply, not optional filler):

WHO: ${userProfile.trading_summary || "Still being established."}
PSYCH PATTERNS: ${userProfile.psychological_patterns || "Still being established."}
TRIGGERS: ${userProfile.key_triggers || "Still being established."}
STRENGTHS: ${userProfile.strengths || "Still being established."}

Use it: emotion/frustration → tie to triggers/patterns above; trade/setup/outcome → name pattern if it matches; repeated mistake memory shows → say so plainly; genuine improvement → acknowledge specifically; praise → history-specific only.

MEMORY INSTRUCTION: Before every response, scan the profile above for relevant patterns. If a pattern matches what the trader just said, surface it as a QUESTION not a directive. Never tell them what to do based on pattern alone. Instead ask: "This looks like [pattern] — does this trade meet your A+ criteria?" You flag. They decide. Always ask about setup quality before making any psychological observation.`;
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

/** sync_state reads/writes use service role when set so RLS cannot block server sync bookkeeping. */
function getSupabaseUrlAndServerKey() {
  const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
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
 * Auto Notion sync (throttled via sync_state).
 * — If `notion_connections` + `notion_mappings` exist for user_id, OAuth sync runs (same as POST /api/notion/sync-user).
 * — Otherwise falls back to env-based syncNotionToSupabase / mum (NOTION_API_KEY).
 * Same sync_state keys (`notion_aiden` / `notion_mum`) for both paths; OAuth wins when mapping is complete (no double-write).
 * handleTrades **awaits** this before reading Supabase so the first response includes data from a completed sync (Vercel timeout still applies for huge DBs).
 */
async function maybeSyncNotion(userId) {
  const syncKey = userId === "spasque70@gmail.com" ? "notion_mum" : "notion_aiden";
  try {
    const lastSynced = await getSyncState(syncKey);
    if (lastSynced && Date.now() - lastSynced.getTime() < NOTION_SYNC_INTERVAL_MS) {
      return; // Data is fresh — skip
    }

    const oauthResult = await syncNotionOAuthForUser(userId);

    if (oauthResult.skipped && (oauthResult.reason === "no_connection" || oauthResult.reason === "no_mapping")) {
      const syncFn = userId === "spasque70@gmail.com" ? syncNotionToSupabaseMum : syncNotionToSupabase;
      const result = await syncFn();
      if (result.ok) {
        await setSyncState(syncKey);
        console.log(`[auto-sync] ${userId}: fetched ${result.fetched}, upserted ${result.upserted}`);
      } else if (result.skipped) {
        console.warn(`[auto-sync] ${userId} (env): skipped — ${result.reason ?? "unknown"}`);
      } else {
        console.warn(
          `[auto-sync] ${userId} (env): did not sync — ${result.reason ?? result.error ?? "unknown"}`
        );
      }
      return;
    }

    if (oauthResult.ok) {
      await setSyncState(syncKey);
      console.log(
        `[auto-sync] ${userId} (oauth): fetched ${oauthResult.fetched}, upserted ${oauthResult.upserted}`
      );
      return;
    }

    if (oauthResult.oauthAuthError) {
      console.warn(
        `[auto-sync] ${userId} (oauth): Notion token rejected (${oauthResult.status ?? "?"}) — reconnect OAuth in onboarding`
      );
    } else {
      console.warn(
        `[auto-sync] ${userId} (oauth): ${oauthResult.reason || "sync failed"}`
      );
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

    await maybeSyncNotion(userId);

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

  // Profile fetch runs in parallel; Notion sync fires in background (fire-and-forget)
  const profilePromise = fetchUserProfile(userId);
  maybeSyncNotion(userId).catch(() => {});

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

  const photoIdxSet = includePhotoLinks
    ? tradePhotoLinkIndices(tradesForChat, messageSource)
    : new Set();

  const slimOptsAt = (i) => {
    const o = {};
    if (includePhotoLinks && photoIdxSet.has(i)) o.includeTradeImages = true;
    if (wantsNotionExtras && extrasIdxSet.has(i)) {
      const slice = pickNotionExtrasSlice(
        tradesForChat[i]?.notion_extras,
        messageSource
      );
      if (slice && Object.keys(slice).length > 0) o.notionExtrasSlice = slice;
    }
    return o;
  };

  if (includePhotoLinks) {
    console.log(
      `[chat] trade photo links — rows with image URLs (0=newest): ${[...photoIdxSet].sort((a, b) => a - b).join(",")}`
    );
  }
  if (wantsNotionExtras) {
    console.log(
      `[chat] notion_extras slices — rows (0=newest): ${[...extrasIdxSet].sort((a, b) => a - b).join(",")}`
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
  if (
    wantsNotionExtras &&
    tradesForPrompt.some(
      (t) => t?.notion_extras && typeof t.notion_extras === "object"
    ) &&
    !columnKeys.includes("notion_extras")
  ) {
    columnKeys = [...columnKeys, "notion_extras"];
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
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const supabaseUrl = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!userId) {
    json(res, 400, { error: "user_id required" });
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

/** GET /api/journal-trades?user_id=eq.{email} — manual LOG TRADE rows (journal_trades). */
async function handleJournalTradesGet(req, res) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }
  const userId = parseSupabaseUserIdParam(req);
  try {
    const endpoint = `${url}/rest/v1/journal_trades?user_id=eq.${encodeURIComponent(userId)}&select=*&order=traded_at.desc`;
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
    json(res, 200, Array.isArray(rows) ? rows : []);
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

function parseSupabaseUserIdParam(req) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  let raw = (u.searchParams.get("user_id") || "").trim();
  if (raw.startsWith("eq.")) raw = raw.slice(3);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  return raw || "aidenpasque11@gmail.com";
}

/** GET /api/accounts?user_id=eq.{email}&include_archived=true */
async function handleTradingAccountsGet(req, res) {
  const { url, key: anonKey } = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || anonKey;
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const userId = parseSupabaseUserIdParam(req);
  const includeArchived =
    u.searchParams.get("include_archived") === "true" || u.searchParams.get("include_archived") === "1";

  let q = `${url}/rest/v1/trading_accounts?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`;
  if (!includeArchived) q += "&archived=eq.false";

  try {
    const r = await fetch(q, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const text = await r.text();
    if (!r.ok) {
      json(res, r.status, { error: formatSupabaseError(text, r.status) });
      return;
    }
    let accounts = JSON.parse(text);
    if (!Array.isArray(accounts)) accounts = [];

    if (accounts.length) {
      const ids = accounts.map((a) => a.id).join(",");
      const r2 = await fetch(
        `${url}/rest/v1/account_equity_snapshots?user_id=eq.${encodeURIComponent(userId)}&account_id=in.(${ids})&select=id,account_id,equity,recorded_at,note&order=recorded_at.asc`,
        { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
      );
      const t2 = await r2.text();
      if (r2.ok) {
        let snaps = [];
        try {
          snaps = JSON.parse(t2);
        } catch {
          snaps = [];
        }
        if (Array.isArray(snaps)) {
          const by = new Map();
          for (const s of snaps) {
            if (!by.has(s.account_id)) by.set(s.account_id, []);
            by.get(s.account_id).push(s);
          }
          for (const row of accounts) {
            const arr = by.get(row.id) || [];
            row.recent_snapshots = arr.length > 60 ? arr.slice(-60) : [...arr];
            row.latest_snapshot = arr.length ? arr[arr.length - 1] : null;
          }
        }
      }
    }

    json(res, 200, { accounts });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** POST /api/accounts */
async function handleTradingAccountsPost(req, res) {
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

  const { url, key: anonKey } = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || anonKey;
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  const userId = String(body.user_id || "aidenpasque11@gmail.com").trim();
  const name = String(body.name || "Account").trim().slice(0, 200);
  const accountType = String(body.account_type || "eval").toLowerCase();
  if (!["eval", "funded", "live"].includes(accountType)) {
    json(res, 400, { error: "account_type must be eval, funded, or live" });
    return;
  }
  const profitTarget = Number(body.profit_target);
  const maxLoss = Number(body.max_loss_limit);
  if (!Number.isFinite(profitTarget) || profitTarget < 0) {
    json(res, 400, { error: "profit_target must be a non-negative number" });
    return;
  }
  if (!Number.isFinite(maxLoss) || maxLoss < 0) {
    json(res, 400, { error: "max_loss_limit must be a non-negative number" });
    return;
  }

  let startingBalance = null;
  if (body.starting_balance != null && body.starting_balance !== "") {
    const sb = Number(body.starting_balance);
    if (!Number.isFinite(sb)) {
      json(res, 400, { error: "starting_balance must be a number" });
      return;
    }
    startingBalance = sb;
  }

  let dailyLoss = null;
  if (body.daily_loss_limit != null && body.daily_loss_limit !== "") {
    const dl = Number(body.daily_loss_limit);
    if (!Number.isFinite(dl) || dl < 0) {
      json(res, 400, { error: "daily_loss_limit must be a non-negative number" });
      return;
    }
    dailyLoss = dl;
  }

  const row = {
    user_id: userId,
    name,
    account_type: accountType,
    starting_balance: startingBalance,
    profit_target: profitTarget,
    max_loss_limit: maxLoss,
    daily_loss_limit: dailyLoss,
    archived: false,
  };

  try {
    const r = await fetch(`${url}/rest/v1/trading_accounts`, {
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
    const acc = Array.isArray(data) ? data[0] : data;
    acc.recent_snapshots = [];
    acc.latest_snapshot = null;
    json(res, 201, { account: acc });
  } catch (e) {
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/** PATCH /api/accounts/:id */
async function handleTradingAccountsPatch(req, res) {
  const pathname = req.url.split("?")[0];
  const m = pathname.match(/^\/api\/accounts\/([^/]+)\/?$/);
  if (!m) {
    json(res, 400, { error: "Invalid path" });
    return;
  }
  const id = m[1];

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

  const userId = String(body.user_id || "").trim();
  if (!userId) {
    json(res, 400, { error: "user_id required" });
    return;
  }

  const { url, key: anonKey } = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || anonKey;
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  try {
    const check = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    const checkText = await check.text();
    if (!check.ok) {
      json(res, check.status, { error: formatSupabaseError(checkText, check.status) });
      return;
    }
    const found = JSON.parse(checkText);
    if (!Array.isArray(found) || found.length === 0) {
      json(res, 404, { error: "Account not found" });
      return;
    }

    const patch = { updated_at: new Date().toISOString() };
    if (body.name != null) patch.name = String(body.name).trim().slice(0, 200);
    if (body.account_type != null) {
      const t = String(body.account_type).toLowerCase();
      if (!["eval", "funded", "live"].includes(t)) {
        json(res, 400, { error: "account_type must be eval, funded, or live" });
        return;
      }
      patch.account_type = t;
    }
    if (body.profit_target != null) {
      const v = Number(body.profit_target);
      if (!Number.isFinite(v) || v < 0) {
        json(res, 400, { error: "profit_target must be a non-negative number" });
        return;
      }
      patch.profit_target = v;
    }
    if (body.max_loss_limit != null) {
      const v = Number(body.max_loss_limit);
      if (!Number.isFinite(v) || v < 0) {
        json(res, 400, { error: "max_loss_limit must be a non-negative number" });
        return;
      }
      patch.max_loss_limit = v;
    }
    if (body.daily_loss_limit !== undefined) {
      if (body.daily_loss_limit === null || body.daily_loss_limit === "") patch.daily_loss_limit = null;
      else {
        const v = Number(body.daily_loss_limit);
        if (!Number.isFinite(v) || v < 0) {
          json(res, 400, { error: "daily_loss_limit must be a non-negative number or empty" });
          return;
        }
        patch.daily_loss_limit = v;
      }
    }
    if (body.starting_balance !== undefined) {
      if (body.starting_balance === null || body.starting_balance === "") patch.starting_balance = null;
      else {
        const v = Number(body.starting_balance);
        if (!Number.isFinite(v)) {
          json(res, 400, { error: "starting_balance must be a number or empty" });
          return;
        }
        patch.starting_balance = v;
      }
    }
    if (body.archived != null) {
      patch.archived = Boolean(body.archived);
    }

    if (Object.keys(patch).length <= 1) {
      json(res, 400, { error: "No updatable fields" });
      return;
    }

    const r = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      }
    );
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

  const { url, key: anonKey } = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || anonKey;
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  try {
    const verify = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
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
      `${url}/rest/v1/account_equity_snapshots?user_id=eq.${encodeURIComponent(userId)}&account_id=eq.${encodeURIComponent(accountId)}&order=recorded_at.desc&limit=${limit}`,
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

  const userId = String(body.user_id || "").trim();
  const accountId = String(body.account_id || "").trim();
  const equity = Number(body.equity);

  if (!userId) {
    json(res, 400, { error: "user_id required" });
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

  const { url, key: anonKey } = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || anonKey;
  if (!url || !key) {
    json(res, 503, { error: "Supabase not configured" });
    return;
  }

  try {
    const verify = await fetch(
      `${url}/rest/v1/trading_accounts?id=eq.${encodeURIComponent(accountId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
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
      user_id: userId,
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
  const userId = (u.searchParams.get("user_id") || "").trim();

  if (!notionId) { json(res, 400, { error: "Missing notion_id" }); return; }

  const notionKey = userId === "spasque70@gmail.com"
    ? process.env.NOTION_API_KEY_MUM?.trim()
    : process.env.NOTION_API_KEY?.trim();

  if (!notionKey) { json(res, 503, { error: "Notion key not configured" }); return; }

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
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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

  if (req.method === "GET" && req.url.startsWith("/api/refresh-trade-image")) {
    await handleRefreshTradeImage(req, res);
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

  if (req.method === "GET" && req.url.startsWith("/api/notion/connect")) {
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

  if (req.method === "POST" && req.url.startsWith("/api/notion/save-mapping")) {
    await handleNotionSaveMapping(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/notion/sync-user")) {
    await handleNotionSyncUser(req, res);
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

  if (req.method === "GET" && req.url.startsWith("/api/journal-trades")) {
    await handleJournalTradesGet(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/log-trade")) {
    await handleLogTrade(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/accounts")) {
    await handleTradingAccountsGet(req, res);
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

// === NOTION OAUTH ===

const NOTION_OAUTH_REDIRECT_URI = "https://operation-jarvis2.vercel.app/api/notion/callback";

async function handleNotionConnect(req, res) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
  if (!clientId) {
    json(res, 500, { error: "NOTION_OAUTH_CLIENT_ID not configured" });
    return;
  }
  const { searchParams } = new URL(req.url, `http://localhost`);
  const userId = searchParams.get("user_id") || "aidenpasque11@gmail.com";
  const state = encodeURIComponent(userId);
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
  const userId = state ? decodeURIComponent(state) : "aidenpasque11@gmail.com";

  if (!code) {
    json(res, 400, { error: "Missing code from Notion callback" });
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
    user_id: userId,
    access_token: tokenData.access_token,
    workspace_name: tokenData.workspace_name ?? null,
    workspace_id: tokenData.workspace_id ?? null,
    bot_id: tokenData.bot_id ?? null,
    created_at: new Date().toISOString(),
  };

  try {
    const upsertRes = await fetch(`${url}/rest/v1/notion_connections`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(row),
    });
    if (!upsertRes.ok) {
      const errText = await upsertRes.text().catch(() => "unknown");
      console.error("[notion/callback] Supabase upsert failed:", upsertRes.status, errText);
    } else {
      console.log("[notion/callback] Supabase upsert success for user:", userId, "workspace:", row.workspace_name);
    }
  } catch (e) {
    console.error("[notion/callback] Supabase upsert error:", String(e.message ?? e));
  }

  send(res, 302, "", { Location: "/app/onboarding/" });
}

async function handleNotionDatabases(req, res) {
  const { searchParams } = new URL(req.url, `http://localhost`);
  const userIdRaw = searchParams.get("user_id") || "aidenpasque11@gmail.com";
  const userId = userIdRaw.startsWith("eq.") ? userIdRaw.slice(3) : userIdRaw;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    json(res, 500, { error: "Supabase not configured" });
    return;
  }

  let accessToken;
  try {
    const cr = await fetch(
      `${url}/rest/v1/notion_connections?user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } }
    );
    const rows = await cr.json().catch(() => null);
    accessToken = Array.isArray(rows) && rows.length > 0 ? rows[0].access_token : null;
  } catch {
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

  try {
    // Step 1 — search API: top-level databases and pages the integration can access
    const sr = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({}),
    });
    if (!sr.ok) {
      const err = await sr.text().catch(() => "unknown");
      json(res, 502, { error: `Notion search failed: ${err}` });
      return;
    }
    const searchData = await sr.json();
    const results = searchData.results ?? [];

    // Collect top-level databases directly from search
    const dbMap = new Map();
    const pageIds = [];
    for (const item of results) {
      if (item.object === "database") {
        dbMap.set(item.id, {
          id: item.id,
          name: item.title?.[0]?.plain_text ?? item.title?.[0]?.text?.content ?? "Untitled",
        });
      } else if (item.object === "page") {
        pageIds.push(item.id);
      }
    }

    // Step 2 — fetch child blocks of each page to find nested child_database blocks
    await Promise.all(
      pageIds.map(async (pageId) => {
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

    json(res, 200, { databases: Array.from(dbMap.values()) });
  } catch (e) {
    json(res, 502, { error: `Notion databases error: ${String(e.message ?? e)}` });
  }
}

// === NOTION COLUMN MAPPING & USER SYNC ===

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
}

function notionPropValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case "title":       return prop.title?.[0]?.plain_text ?? null;
    case "rich_text":   return prop.rich_text?.[0]?.plain_text ?? null;
    case "number":      return prop.number ?? null;
    case "select":      return prop.select?.name ?? null;
    case "multi_select":return prop.multi_select?.map((o) => o.name).join(", ") ?? null;
    case "date":        return prop.date?.start ?? null;
    case "checkbox":    return prop.checkbox ?? null;
    case "url":         return prop.url ?? null;
    case "files":       return prop.files?.map((f) => f.external?.url ?? f.file?.url).filter(Boolean) ?? null;
    case "email":       return prop.email ?? null;
    case "phone_number":return prop.phone_number ?? null;
    case "formula":     return prop.formula?.string ?? prop.formula?.number ?? null;
    default:            return null;
  }
}

async function handleNotionColumns(req, res) {
  const sp = new URL(req.url, "http://localhost").searchParams;
  const userIdRaw = sp.get("user_id") || "aidenpasque11@gmail.com";
  const userId = userIdRaw.startsWith("eq.") ? userIdRaw.slice(3) : userIdRaw;
  const databaseId = sp.get("database_id") || "";
  if (!databaseId) { json(res, 400, { error: "database_id required" }); return; }

  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) { json(res, 500, { error: "Supabase not configured" }); return; }

  let accessToken;
  try {
    const cr = await fetch(
      `${url}/rest/v1/notion_connections?user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers: { apikey: srKey, Authorization: `Bearer ${srKey}`, Accept: "application/json" } }
    );
    const rows = await cr.json().catch(() => null);
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

    // Helper: query one page and extract columns from its properties
    const columnsFromPageQuery = async (endpoint) => {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 1 }),
      });
      const text = await r.text();
      console.log(`[notion/columns] query ${endpoint} → ${r.status}:`, text.slice(0, 300));
      if (!r.ok) return null;
      const data = JSON.parse(text);
      const first = data.results?.[0];
      if (!first?.properties) return null;
      return Object.entries(first.properties).map(([name, prop]) => ({ name, type: prop.type ?? "unknown" }));
    };

    // For merged databases, Notion requires /data_sources/{id}/query (same endpoint the native sync uses)
    // data_sources[].id stripped of dashes is the correct format for that endpoint.
    const dataSources = Array.isArray(schema.data_sources) ? schema.data_sources : [];
    if (dataSources.length > 0) {
      const rawId = dataSources[0].id ?? dataSources[0];
      const dataSourceId = String(rawId).replace(/-/g, "");
      console.log("[notion/columns] merged DB — querying data_source:", dataSourceId);
      const cols = await columnsFromPageQuery(
        `https://api.notion.com/v1/data_sources/${dataSourceId}/query`
      );
      if (cols) {
        console.log("[notion/columns] data_source columns:", cols.map(c => c.name));
        json(res, 200, { columns: cols, data_source_id: dataSourceId });
        return;
      }
      json(res, 502, { error: "Could not retrieve columns from merged database data source." }); return;
    }

    // Standard DB: schema.properties may already have what we need
    if (schema.properties && Object.keys(schema.properties).length > 0) {
      const columns = Object.entries(schema.properties).map(([name, prop]) => ({
        name,
        type: prop.type ?? "unknown",
      }));
      console.log("[notion/columns] schema properties →", columns.length, "columns");
      json(res, 200, { columns });
      return;
    }

    // Standard DB fallback: query one page
    const cols = await columnsFromPageQuery(`https://api.notion.com/v1/databases/${databaseId}/query`);
    if (cols) {
      console.log("[notion/columns] page-query columns:", cols.map(c => c.name));
      json(res, 200, { columns: cols });
      return;
    }
    json(res, 200, { columns: [], debug: "No pages found in database" });
  } catch (e) {
    json(res, 502, { error: `Notion columns error: ${String(e.message ?? e)}` });
  }
}

async function handleNotionSaveMapping(req, res) {
  let body;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch { json(res, 400, { error: "Invalid JSON body" }); return; }

  const { user_id, database_id, mapping, data_source_id } = body ?? {};
  if (!user_id || !database_id || !mapping) {
    json(res, 400, { error: "user_id, database_id, and mapping required" }); return;
  }

  // Embed data_source_id (for merged DBs) into the mapping JSON so sync can use it
  const mappingWithMeta = data_source_id
    ? { ...mapping, __data_source_id: data_source_id }
    : mapping;

  const { url } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) { json(res, 500, { error: "Supabase not configured" }); return; }

  try {
    const upsertRes = await fetch(`${url}/rest/v1/notion_mappings`, {
      method: "POST",
      headers: {
        apikey: srKey,
        Authorization: `Bearer ${srKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ user_id, database_id, mapping: mappingWithMeta, created_at: new Date().toISOString() }),
    });
    if (!upsertRes.ok) {
      const err = await upsertRes.text().catch(() => "unknown");
      json(res, 502, { error: `Save mapping failed: ${err}` }); return;
    }
    json(res, 200, { success: true });
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
 * OAuth + notion_mappings → trades (shared by POST /api/notion/sync-user and maybeSyncNotion).
 * Notion OAuth access tokens are not refreshed here (schema has no refresh_token); reconnect if Notion invalidates the token.
 *
 * @returns { skipped: true, reason: 'no_connection'|'no_mapping' } — use legacy env sync
 * @returns { ok: true, fetched, upserted, skipped: false }
 * @returns { ok: false, skipped: false, reason, oauthAuthError?, status? }
 */
async function syncNotionOAuthForUser(userId) {
  const { url, tableRaw } = getSupabaseConfig();
  const srKey = getServiceRoleKey();
  if (!url || !srKey) {
    return { ok: false, skipped: false, reason: "Supabase not configured" };
  }

  let accessToken;
  let databaseId;
  let mapping;
  try {
    const [connRes, mapRes] = await Promise.all([
      fetch(`${url}/rest/v1/notion_connections?user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
        headers: { apikey: srKey, Authorization: `Bearer ${srKey}`, Accept: "application/json" },
      }),
      fetch(`${url}/rest/v1/notion_mappings?user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
        headers: { apikey: srKey, Authorization: `Bearer ${srKey}`, Accept: "application/json" },
      }),
    ]);
    const connRows = await connRes.json().catch(() => null);
    const mapRows = await mapRes.json().catch(() => null);
    accessToken = Array.isArray(connRows) && connRows.length > 0 ? connRows[0].access_token : null;
    databaseId = Array.isArray(mapRows) && mapRows.length > 0 ? mapRows[0].database_id : null;
    mapping = Array.isArray(mapRows) && mapRows.length > 0 ? mapRows[0].mapping : null;
    if (mapping != null && typeof mapping === "string") {
      try {
        mapping = JSON.parse(mapping);
      } catch {
        mapping = null;
      }
    }
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      reason: `Failed to read connection/mapping: ${String(e.message ?? e)}`,
    };
  }

  if (!accessToken) return { skipped: true, reason: "no_connection" };
  if (!databaseId || mapping == null || typeof mapping !== "object" || Array.isArray(mapping)) {
    return { skipped: true, reason: "no_mapping" };
  }

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
        };
      }
      const data = await qRes.json();
      allPages.push(...(data.results ?? []));
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);
  } catch (e) {
    return { ok: false, skipped: false, reason: String(e.message ?? e) };
  }

  const tableEnc = encodeURIComponent(tableRaw);
  const batch = [];

  for (const page of allPages) {
    const props = page.properties ?? {};
    const get = (field) => notionPropValue(props[mapping[field]]);

    const rrRaw = get("rr");
    const rrNum = rrRaw != null ? Number(String(rrRaw).replace(/[^0-9.\-]/g, "")) : null;
    const dateVal = parseDateToIso(get("date")) ?? parseDateToIso(page.created_time);
    if (!dateVal) continue;

    batch.push({
      notion_id: page.id,
      user_id: userId,
      date: dateVal,
      outcome: get("outcome"),
      rr: rrNum != null && !isNaN(rrNum) ? rrNum : null,
      session: get("session"),
      pair: get("pair"),
      direction: get("direction"),
      notes: get("notes"),
      model: get("model"),
      notion_url: page.url ?? null,
      trade_images: get("photos") ?? [],
      updated_at: new Date().toISOString(),
    });
  }

  const fetched = allPages.length;

  if (batch.length > 0) {
    try {
      const upsertCols =
        "notion_id,user_id,date,outcome,rr,session,pair,direction,notes,model,notion_url,trade_images,updated_at";
      const upsertRes = await fetch(`${url}/rest/v1/${tableEnc}?on_conflict=notion_id&columns=${upsertCols}`, {
        method: "POST",
        headers: {
          apikey: srKey,
          Authorization: `Bearer ${srKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(batch),
      });
      if (!upsertRes.ok) {
        const err = await upsertRes.text().catch(() => "unknown");
        return { ok: false, skipped: false, reason: `Trades upsert failed: ${err}` };
      }
    } catch (e) {
      return { ok: false, skipped: false, reason: String(e.message ?? e) };
    }
  }

  return { ok: true, fetched, upserted: batch.length, skipped: false };
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

  const { user_id } = body ?? {};
  if (!user_id) {
    json(res, 400, { error: "user_id required" });
    return;
  }

  const result = await syncNotionOAuthForUser(user_id);

  if (result.skipped && result.reason === "no_connection") {
    json(res, 404, { error: "No Notion connection found" });
    return;
  }
  if (result.skipped && result.reason === "no_mapping") {
    json(res, 404, { error: "No column mapping found — complete setup first" });
    return;
  }

  if (!result.ok) {
    if (result.oauthAuthError) {
      json(res, 401, { error: result.reason || "Notion token rejected — reconnect OAuth" });
      return;
    }
    json(res, 502, { error: result.reason || "Sync failed" });
    return;
  }

  json(res, 200, { synced: result.upserted });
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
