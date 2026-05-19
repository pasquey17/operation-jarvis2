/**
 * deep-think.mjs — weekly Sonnet analytical layer (step 5).
 * One infrequent call synthesises intelligence file + memories + trade notes.
 */

import { getIntelligenceFile } from "./intelligence-file.mjs";
import { listMemoriesForUser } from "./memory-system.mjs";

const ANTHROPIC_VERSION = "2023-06-01";
const DEEP_THINK_MODEL = "claude-sonnet-4-5";
const MAX_DEEP_THINK_OUTPUT = 2500;
const TRADE_SAMPLE_LIMIT = 50;
const MAX_INTEL_JSON_CHARS = 14000;
const MAX_TRADE_BLOCK_CHARS = 22000;
const MAX_MEMORIES_CHARS = 4000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_TRADES_THRESHOLD = 20;

const HIGH_SIGNAL_EXTRA_KEYS = [
  "psychology",
  "psych",
  "mindset",
  "emotion",
  "htf",
  "ltf",
  "bias",
  "volume",
  "confluence",
  "setup",
  "entry",
  "exit",
  "mistake",
  "lesson",
  "rating",
  "grade",
  "a+",
  "discipline",
  "plan",
  "trigger",
];

const deepThinkInflight = new Map();

function sbConfig() {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY?.trim() || "";
  return { url, key };
}

async function sbFetch(path, opts = {}) {
  const { url, key } = sbConfig();
  if (!url || !key) throw new Error("Missing Supabase config");
  return fetch(`${url}${path}`, {
    ...opts,
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Cache-Control": "no-store",
      ...(opts.headers ?? {}),
    },
  });
}

function extractAssistantText(data) {
  if (!data?.content || !Array.isArray(data.content)) return "";
  return data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function stripMarkdownArtifacts(text) {
  return String(text || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function extraKeyScore(key) {
  const kl = String(key).toLowerCase();
  for (let i = 0; i < HIGH_SIGNAL_EXTRA_KEYS.length; i++) {
    if (kl.includes(HIGH_SIGNAL_EXTRA_KEYS[i])) return 10 - i;
  }
  return 0;
}

function pickNotionExtrasForDeepThink(extras) {
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return null;
  const entries = Object.entries(extras).filter(
    ([, v]) => v != null && String(v).trim() !== ""
  );
  if (!entries.length) return null;

  entries.sort((a, b) => extraKeyScore(b[0]) - extraKeyScore(a[0]));
  const out = {};
  for (const [k, v] of entries.slice(0, 14)) {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    out[k] = s.length > 220 ? `${s.slice(0, 217)}…` : s;
  }
  return Object.keys(out).length ? out : null;
}

function slimTradeForDeepThink(t) {
  const notes = String(t?.notes ?? "").trim();
  return {
    date: t?.date || null,
    session: t?.session ?? null,
    pair: t?.pair ?? null,
    direction: t?.direction ?? null,
    outcome: t?.outcome ?? null,
    rr: t?.rr ?? null,
    model: t?.model ?? null,
    notes: notes ? (notes.length > 450 ? `${notes.slice(0, 447)}…` : notes) : null,
    notion_extras: pickNotionExtrasForDeepThink(t?.notion_extras),
  };
}

async function fetchRecentTradesForDeepThink(userId, limit = TRADE_SAMPLE_LIMIT) {
  const table = (process.env.SUPABASE_TABLE ?? "trades").trim() || "trades";
  const path =
    `/rest/v1/${encodeURIComponent(table)}` +
    `?select=date,session,pair,direction,outcome,rr,model,notes,notion_extras` +
    `&auth_user_id=eq.${encodeURIComponent(userId)}&archived=is.false` +
    `&order=date.desc&limit=${limit}`;

  const res = await sbFetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`trades read ${res.status}: ${t.slice(0, 200)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function countActiveTrades(userId) {
  const table = (process.env.SUPABASE_TABLE ?? "trades").trim() || "trades";
  const res = await sbFetch(
    `/rest/v1/${encodeURIComponent(table)}?auth_user_id=eq.${encodeURIComponent(userId)}&archived=is.false&select=id`,
    {
      headers: {
        Accept: "application/json",
        Prefer: "count=exact",
        Range: "0-0",
      },
    }
  );
  const cr = res.headers.get("Content-Range") ?? "";
  const m = cr.match(/\/(\d+)$/);
  if (m) return parseInt(m[1], 10);
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : null;
}

async function readIntelligenceRow(userId) {
  const res = await sbFetch(
    `/rest/v1/intelligence_files?auth_user_id=eq.${encodeURIComponent(userId)}&select=auth_user_id,deep_think,deep_think_at,deep_think_trade_count,trade_count_at_generation,generated_at`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`intelligence_files read ${res.status}: ${t.slice(0, 200)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function saveDeepThink(userId, text, tradeCount) {
  const res = await sbFetch(
    `/rest/v1/intelligence_files?auth_user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        deep_think: text,
        deep_think_at: new Date().toISOString(),
        deep_think_trade_count: tradeCount,
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`deep_think save ${res.status}: ${t.slice(0, 200)}`);
  }
}

function formatMemoriesBlock(memories) {
  if (!memories?.length) return "No stored conversation memories yet.";
  let block = memories
    .map((m) => `[${m.category || "context"}|imp ${m.importance ?? "?"}] ${m.memory}`)
    .join("\n");
  if (block.length > MAX_MEMORIES_CHARS) {
    block = block.slice(0, MAX_MEMORIES_CHARS - 24).trimEnd() + "\n[memories truncated]";
  }
  return block;
}

function buildDeepThinkPrompt(intelFile, memories, trades) {
  let intelJson = JSON.stringify(intelFile ?? {}, null, 2);
  if (intelJson.length > MAX_INTEL_JSON_CHARS) {
    intelJson = intelJson.slice(0, MAX_INTEL_JSON_CHARS - 20) + "\n…[truncated]";
  }

  const tradeRows = trades.map(slimTradeForDeepThink);
  let tradesJson = JSON.stringify(tradeRows, null, 2);
  if (tradesJson.length > MAX_TRADE_BLOCK_CHARS) {
    tradesJson = tradesJson.slice(0, MAX_TRADE_BLOCK_CHARS - 20) + "\n…[truncated]";
  }

  const memoriesBlock = formatMemoriesBlock(memories);

  return `You are an elite trading performance analyst. You have one job: write a deep insight report for this specific trader using ONLY the evidence below. Do not give generic trading advice.

Cover these themes in flowing plain prose (no section headers, no bullet points, no markdown, no numbered lists):
1) THE REAL STORY — what is genuinely going on with this trader right now; the narrative behind the numbers.
2) HIDDEN PATTERNS — connections between psychology, behaviour, and stats they likely cannot see themselves.
3) THE ONE THING — the single most important focus for this week and why.
4) WHAT IS IMPROVING — honest progress vs regression.
5) BLIND SPOTS — what they are probably wrong about regarding their own trading.

Rules:
- Plain English prose only. Sharp, direct, analytical. No markdown symbols.
- Anchor claims in their data. If sample size is thin, say so briefly.
- No buy/sell calls. No invented statistics.
- Roughly 500–900 words total.

=== INTELLIGENCE FILE (structured stats) ===
${intelJson}

=== STORED MEMORIES (from past Jarvis conversations) ===
${memoriesBlock}

=== LAST ${tradeRows.length} TRADES (notes + notion_extras, newest first) ===
${tradesJson}`;
}

export async function shouldRunDeepThink(userId) {
  if (!userId) return false;

  let row;
  try {
    row = await readIntelligenceRow(userId);
  } catch {
    return true;
  }

  const existing = row?.deep_think != null && String(row.deep_think).trim();
  if (!existing) return true;

  if (row.deep_think_at) {
    const ageMs = Date.now() - new Date(row.deep_think_at).getTime();
    if (ageMs > SEVEN_DAYS_MS) return true;
  } else {
    return true;
  }

  const baseline = row.deep_think_trade_count;
  if (baseline == null) return true;

  try {
    const current = await countActiveTrades(userId);
    if (current != null && current - baseline >= NEW_TRADES_THRESHOLD) return true;
  } catch {
    /* keep false if count fails */
  }

  return false;
}

export async function getDeepThinkStatus(userId) {
  if (!userId) throw new Error("userId required");
  const row = await readIntelligenceRow(userId);
  const currentTradeCount = await countActiveTrades(userId).catch(() => null);
  return {
    user_id: userId,
    deep_think: row?.deep_think ?? null,
    deep_think_at: row?.deep_think_at ?? null,
    deep_think_trade_count: row?.deep_think_trade_count ?? null,
    current_trade_count: currentTradeCount,
    has_deep_think: Boolean(row?.deep_think && String(row.deep_think).trim()),
  };
}

export async function getDeepThinkForPrompt(userId) {
  if (!userId) return "";
  try {
    const row = await readIntelligenceRow(userId);
    const t = row?.deep_think;
    return t && String(t).trim() ? String(t).trim() : "";
  } catch {
    return "";
  }
}

/**
 * One Sonnet call; saves deep_think on intelligence_files row.
 * @returns {Promise<{ deep_think: string, deep_think_at: string, deep_think_trade_count: number, trade_count: number }>}
 */
export async function runDeepThink(userId) {
  if (!userId || typeof userId !== "string") throw new Error("userId required");

  if (deepThinkInflight.has(userId)) return deepThinkInflight.get(userId);

  const work = (async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const t0 = Date.now();
    const [intelFile, memories, trades, tradeCount] = await Promise.all([
      getIntelligenceFile(userId),
      listMemoriesForUser(userId).catch(() => []),
      fetchRecentTradesForDeepThink(userId, TRADE_SAMPLE_LIMIT),
      countActiveTrades(userId),
    ]);

    const prompt = buildDeepThinkPrompt(intelFile, memories, trades);

    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEEP_THINK_MODEL,
        max_tokens: MAX_DEEP_THINK_OUTPUT,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!ar.ok) {
      const errText = await ar.text();
      throw new Error(`Anthropic deep-think ${ar.status}: ${errText.slice(0, 300)}`);
    }

    const data = await ar.json();
    let text = stripMarkdownArtifacts(extractAssistantText(data));
    if (!text) throw new Error("Empty deep-think response from model");

    const stampedCount =
      tradeCount != null ? tradeCount : intelFile?.tradeCount ?? trades.length;

    await saveDeepThink(userId, text, stampedCount);

    const at = new Date().toISOString();
    console.log(
      `[deep-think] saved for ${userId} trades=${stampedCount} chars=${text.length} ms=${Date.now() - t0}`
    );

    return {
      deep_think: text,
      deep_think_at: at,
      deep_think_trade_count: stampedCount,
      trade_count: stampedCount,
    };
  })().finally(() => {
    deepThinkInflight.delete(userId);
  });

  deepThinkInflight.set(userId, work);
  return work;
}

export function fireDeepThinkIfNeeded(userId) {
  shouldRunDeepThink(userId)
    .then((should) => {
      if (!should) return null;
      return runDeepThink(userId);
    })
    .catch((e) =>
      console.warn(
        `[deep-think] background failed for ${userId}:`,
        e instanceof Error ? e.message : e
      )
    );
}
