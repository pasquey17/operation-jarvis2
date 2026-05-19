/**
 * Jarvis conversation memory — searchable entries per user (step 4).
 * Complements the 8-field user_profiles summary; does not replace it.
 */

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const MEMORY_TABLE = "jarvis_memories";
const MAX_MEMORIES_RETURNED = 8;
const MAX_MEMORIES_PER_USER = 100;
const MAX_PROMPT_MEMORY_CHARS = 3200;
const VALID_CATEGORIES = new Set([
  "rule",
  "psychology",
  "goal",
  "preference",
  "context",
]);

function sbConfig() {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_ANON_KEY?.trim() || "";
  return { url, key };
}

async function sbFetch(path, opts = {}) {
  const { url, key } = sbConfig();
  if (!url || !key) throw new Error("SUPABASE_CONFIG");
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

function normalizeMemoryText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNearDuplicate(newText, existingRows) {
  const n = normalizeMemoryText(newText);
  if (!n || n.length < 10) return true;
  for (const row of existingRows) {
    const e = normalizeMemoryText(row.memory);
    if (!e) continue;
    if (e === n) return true;
    const shorter = e.length < n.length ? e : n;
    const longer = e.length < n.length ? n : e;
    if (longer.includes(shorter) && shorter.length / longer.length >= 0.82) {
      return true;
    }
  }
  return false;
}

function messageWords(message) {
  return [
    ...new Set(
      String(message || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3)
    ),
  ];
}

function scoreMemoryRow(row, words) {
  const mem = normalizeMemoryText(row.memory);
  let score = Number(row.importance) || 5;
  if (score >= 8) score += 4;
  score += Math.min(5, Number(row.reference_count) || 0);
  for (const w of words) {
    if (mem.includes(w)) score += 3;
  }
  if (row.category && words.some((w) => w === row.category || w.includes(row.category))) {
    score += 2;
  }
  return score;
}

function extractAssistantText(data) {
  const blocks = data?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

function parseMemoriesJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    const arr = Array.isArray(parsed?.memories) ? parsed.memories : [];
    return arr
      .map((m) => ({
        memory: String(m?.memory ?? "").trim(),
        category: String(m?.category ?? "context")
          .trim()
          .toLowerCase(),
        importance: Math.min(
          10,
          Math.max(1, Math.round(Number(m?.importance) || 5))
        ),
      }))
      .filter((m) => m.memory.length >= 8);
  } catch {
    return [];
  }
}

async function fetchAllMemoriesForUser(userId) {
  const res = await sbFetch(
    `/rest/v1/${MEMORY_TABLE}?auth_user_id=eq.${encodeURIComponent(userId)}&select=id,memory,category,importance,created_at,last_referenced,reference_count&order=importance.desc,reference_count.desc,created_at.desc`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`jarvis_memories read ${res.status}: ${t.slice(0, 200)}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function insertMemory(userId, entry) {
  const category = VALID_CATEGORIES.has(entry.category)
    ? entry.category
    : "context";
  const res = await sbFetch(`/rest/v1/${MEMORY_TABLE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      auth_user_id: userId,
      user_id: userId,
      memory: entry.memory,
      category,
      importance: entry.importance,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`jarvis_memories insert ${res.status}: ${t.slice(0, 200)}`);
  }
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function touchMemoryReferences(ids) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  for (const id of ids) {
    const rowRes = await sbFetch(
      `/rest/v1/${MEMORY_TABLE}?id=eq.${encodeURIComponent(id)}&select=reference_count`,
      { headers: { Accept: "application/json" } }
    );
    if (!rowRes.ok) continue;
    const rows = await rowRes.json().catch(() => []);
    const prev = Array.isArray(rows) && rows[0] ? Number(rows[0].reference_count) || 0 : 0;
    await sbFetch(`/rest/v1/${MEMORY_TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        reference_count: prev + 1,
        last_referenced: now,
      }),
    });
  }
}

/**
 * Format top memories for chat system prompt (~800 token cap).
 */
export function formatMemoriesForPrompt(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return "";
  const lines = memories.map((m) => {
    const cat = m.category || "context";
    const imp = m.importance ?? 5;
    return `[${cat}|${imp}/10] ${String(m.memory || "").trim()}`;
  });
  let block = `=== RELEVANT MEMORIES ===\n${lines.join("\n")}`;
  if (block.length > MAX_PROMPT_MEMORY_CHARS) {
    block =
      block.slice(0, MAX_PROMPT_MEMORY_CHARS - 24).trimEnd() +
      "\n[memories truncated]";
  }
  return block;
}

/**
 * Top relevant memories for this message; bumps reference_count.
 */
export async function getRelevantMemories(userId, userMessage) {
  if (!userId) return [];
  const { url, key } = sbConfig();
  if (!url || !key) return [];

  let rows;
  try {
    rows = await fetchAllMemoriesForUser(userId);
  } catch (e) {
    console.warn(
      "[memory-system] getRelevantMemories:",
      e instanceof Error ? e.message : e
    );
    return [];
  }
  if (!rows.length) return [];

  const words = messageWords(userMessage);
  const ranked = rows
    .map((row) => ({ row, score: scoreMemoryRow(row, words) }))
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const seen = new Set();
  for (const { row } of ranked) {
    if (picked.length >= MAX_MEMORIES_RETURNED) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    picked.push(row);
  }

  void touchMemoryReferences(picked.map((r) => r.id)).catch((e) =>
    console.warn(
      "[memory-system] touch refs:",
      e instanceof Error ? e.message : e
    )
  );

  return picked;
}

/**
 * Fire-and-forget: extract durable memories from one exchange.
 */
export async function extractAndStoreMemories(
  userId,
  userMessage,
  jarvisReply,
  apiKey
) {
  if (!userId || !apiKey) return;
  const { url, key } = sbConfig();
  if (!url || !key) return;

  const trader = String(userMessage || "").trim().slice(0, 700);
  const jarvis = String(jarvisReply || "").trim().slice(0, 700);
  if (trader.length < 12 && jarvis.length < 12) return;

  const prompt = `You extract long-term memories for a trading coach AI. Review this exchange.

Trader: ${trader}
Jarvis: ${jarvis}

Extract 0-3 memories ONLY if the trader revealed something worth remembering across future sessions:
- stated trading rules (A+, risk, sessions)
- psychological admissions or triggers
- goals or intentions
- preferences for how they want to be coached
- personal context about their life or trading setup

Do NOT store: small talk, stats already in trade databases, generic market opinions, things Jarvis said.

Return ONLY JSON:
{"memories":[{"memory":"short clear sentence","category":"rule|psychology|goal|preference|context","importance":1-10}]}

If nothing worth storing: {"memories":[]}`;

  try {
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 280,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!ar.ok) {
      console.warn("[memory-system] extract API", ar.status);
      return;
    }
    const data = await ar.json().catch(() => null);
    if (!data) return;
    const extracted = parseMemoriesJson(extractAssistantText(data));
    if (!extracted.length) return;

    let existing = [];
    try {
      existing = await fetchAllMemoriesForUser(userId);
    } catch {
      existing = [];
    }

    let stored = 0;
    for (const entry of extracted) {
      if (isNearDuplicate(entry.memory, existing)) continue;
      try {
        const row = await insertMemory(userId, entry);
        if (row) {
          existing.push(row);
          stored += 1;
        }
      } catch (e) {
        console.warn(
          "[memory-system] insert:",
          e instanceof Error ? e.message : e
        );
      }
    }
    if (stored > 0) {
      console.log(`[memory-system] stored ${stored} memories for ${userId}`);
      await pruneMemories(userId);
    }
  } catch (e) {
    console.warn(
      "[memory-system] extract failed:",
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Keep the bank lean — max 100 rows per user.
 */
export async function pruneMemories(userId) {
  if (!userId) return;
  const { url, key } = sbConfig();
  if (!url || !key) return;

  let rows;
  try {
    rows = await fetchAllMemoriesForUser(userId);
  } catch {
    return;
  }
  if (rows.length <= MAX_MEMORIES_PER_USER) return;

  const sorted = [...rows].sort((a, b) => {
    const impA = Number(a.importance) || 0;
    const impB = Number(b.importance) || 0;
    if (impA !== impB) return impA - impB;
    const refA = Number(a.reference_count) || 0;
    const refB = Number(b.reference_count) || 0;
    if (refA !== refB) return refA - refB;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const toDrop = sorted.slice(0, rows.length - MAX_MEMORIES_PER_USER);
  for (const row of toDrop) {
    if (!row.id) continue;
    await sbFetch(
      `/rest/v1/${MEMORY_TABLE}?id=eq.${encodeURIComponent(row.id)}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      }
    );
  }
  if (toDrop.length > 0) {
    console.log(
      `[memory-system] pruned ${toDrop.length} memories for ${userId}`
    );
  }
}

/** For GET /api/memories inspection. */
export async function listMemoriesForUser(userId) {
  return fetchAllMemoriesForUser(userId);
}
