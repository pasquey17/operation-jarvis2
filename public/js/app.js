const API_CHAT = "/api/chat";
const API_TRADES = "/api/trades";
const STORAGE_KEY_CHAT = "operationJarvis.chat.v1";
const CHAT_RECENT_TRADES = 15;
const MAX_CHAT_MESSAGES_API = 5;
const MAX_CHAT_MESSAGE_CHARS = 1800;
const MAX_CHAT_MESSAGES_STORED = 120;

const GOLD = "#F0B429";
const BLUE = "#4E9FFF";

let currentUserId = null;
let snapshotRequestSeq = 0;

function ensureUserId() {
  const existing = localStorage.getItem("user_id");
  if (existing && existing.trim()) {
    currentUserId = existing.trim();
    return Promise.resolve(currentUserId);
  }

  return new Promise((resolve) => {
    const style = document.createElement("style");
    style.textContent = `
      .login-overlay {
        position: fixed;
        inset: 0;
        background: rgba(10, 10, 15, 0.92);
        display: grid;
        place-items: center;
        z-index: 9999;
      }
      .login-card {
        width: min(420px, calc(100vw - 48px));
        background: rgba(20, 20, 28, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 18px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
        color: rgba(255, 255, 255, 0.92);
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .login-title {
        margin: 0 0 10px 0;
        font-size: 16px;
        letter-spacing: 0.06em;
      }
      .login-input {
        width: 100%;
        box-sizing: border-box;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(10, 10, 15, 0.7);
        color: rgba(255, 255, 255, 0.92);
        padding: 12px 12px;
        outline: none;
      }
      .login-row {
        display: flex;
        gap: 10px;
        margin-top: 12px;
      }
      .login-btn {
        flex: 1;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(78, 159, 255, 0.18);
        color: rgba(255, 255, 255, 0.92);
        padding: 12px 12px;
        cursor: pointer;
      }
      .login-btn:hover {
        background: rgba(78, 159, 255, 0.26);
      }
    `;

    const overlay = document.createElement("div");
    overlay.className = "login-overlay";

    const card = document.createElement("div");
    card.className = "login-card";

    const title = document.createElement("h2");
    title.className = "login-title";
    title.textContent = "LOGIN";

    const input = document.createElement("input");
    input.className = "login-input";
    input.placeholder = "Enter your email";
    input.autocomplete = "email";
    input.inputMode = "email";

    const row = document.createElement("div");
    row.className = "login-row";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "login-btn";
    btn.textContent = "Continue";

    async function submit() {
      const email = (input.value || "").trim() || "aidenpasque11@gmail.com";
      currentUserId = email;
      localStorage.setItem("user_id", email);
      await loadTrades();
      overlay.remove();
      style.remove();
      resolve(email);
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    row.appendChild(btn);
    card.appendChild(title);
    card.appendChild(input);
    card.appendChild(row);
    overlay.appendChild(card);

    document.head.appendChild(style);
    document.body.appendChild(overlay);
    input.focus();
  });
}

let chatSending = false;
/** @type {{ role: string, content: string }[]} */
let chatMessages = [];
/** @type {{ role: string, content: string }[]} */
let chatUiMessages = [];

/** @type {{ headers: string[], records: Record<string,string>[] } | null} */
let tradeData = null;
let tradesLoaded = false;

/** Orb visual state: idle pulse vs active surge */
let orbMode = "idle";

function readApiErrorMessage(data) {
  if (!data || typeof data !== "object") return "";
  const e = data.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof e.message === "string") return e.message;
  return "";
}

const els = {
  form: document.getElementById("chat-form"),
  chatHistory: document.getElementById("chat-history"),
  chatScroll: document.getElementById("chat-scroll"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
  orbCanvas: document.getElementById("orb-canvas"),
  snapshot: document.getElementById("system-snapshot"),
  snapWinrate: document.getElementById("snap-winrate"),
  snapAvgRR: document.getElementById("snap-avgrr"),
  snapExpectancy: document.getElementById("snap-expectancy"),
  snapTotal: document.getElementById("snap-total"),
  snapInsight: document.getElementById("snap-insight"),
};

function setUIMode(mode) {
  const m = mode === "chat" ? "chat" : "idle";
  document.body.dataset.mode = m;
}

function enterChatMode() {
  setUIMode("chat");
  renderChatHistory();
}

function truncateChatContent(text) {
  if (text.length <= MAX_CHAT_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_CHAT_MESSAGE_CHARS)}\n[truncated]`;
}

function filterChatForApi(msgs) {
  return msgs.filter((m) => m.role === "user" || m.role === "assistant");
}

function trimChatMessagesForApi(msgs) {
  if (!msgs.length) return msgs;

  const trimmed = msgs.map((m) => ({
    role: m.role,
    content: truncateChatContent(m.content),
  }));

  if (trimmed.length <= MAX_CHAT_MESSAGES_API) return trimmed;

  const last = trimmed[trimmed.length - 1];
  if (last.role !== "user") {
    return [{ role: last.role, content: truncateChatContent(last.content) }];
  }

  const out = [{ role: last.role, content: last.content }];
  for (let i = trimmed.length - 2; i >= 0 && out.length < MAX_CHAT_MESSAGES_API; i -= 1) {
    const need = out[0].role === "user" ? "assistant" : "user";
    if (trimmed[i].role !== need) break;
    out.unshift({
      role: trimmed[i].role,
      content: trimmed[i].content,
    });
  }
  return out;
}

function loadChatMessagesFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const m of data) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      if (typeof m.content !== "string" || !m.content.trim()) continue;
      out.push({ role: m.role, content: m.content });
    }
    return out;
  } catch {
    return [];
  }
}

function persistChatMessages() {
  try {
    const trimmed = chatMessages.slice(-MAX_CHAT_MESSAGES_STORED);
    localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("Could not save chat", e);
  }
}

function scrollChatToBottom() {
  if (!els.chatScroll) return;
  els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
}

function renderChatHistory() {
  if (!els.chatHistory) return;
  els.chatHistory.innerHTML = "";
  for (const m of chatUiMessages) {
    const row = document.createElement("div");
    row.className =
      m.role === "user"
        ? "msg msg--user"
        : m.role === "error"
          ? "msg msg--error"
          : "msg msg--jarvis";
    row.textContent = m.content;
    els.chatHistory.appendChild(row);
  }
  scrollChatToBottom();
}

async function renderSnapshot() {
  const s = tradeData?.snapshot;
  if (!s || typeof s !== "object") {
    if (els.snapWinrate) els.snapWinrate.textContent = "—";
    if (els.snapAvgRR) els.snapAvgRR.textContent = "—";
    if (els.snapExpectancy) els.snapExpectancy.textContent = "—";
    if (els.snapTotal) els.snapTotal.textContent = "—";
    if (els.snapInsight) els.snapInsight.textContent = "Loading your system…";
    return;
  }

  if (els.snapTotal) els.snapTotal.textContent = String(s.total ?? "—");
  if (els.snapWinrate) els.snapWinrate.textContent = s.winRate == null ? "—" : `${Number(s.winRate).toFixed(1)}%`;
  if (els.snapAvgRR) els.snapAvgRR.textContent = s.avgRR == null ? "—" : Number(s.avgRR).toFixed(2);
  if (els.snapExpectancy) els.snapExpectancy.textContent = s.expectancy == null ? "—" : `${Number(s.expectancy).toFixed(2)}R`;
  if (els.snapInsight) {
    els.snapInsight.textContent = s.bestSession ? `Most active session: ${s.bestSession}` : "—";
  }
}

function getRecentTradesForChat(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  return records.slice(-CHAT_RECENT_TRADES);
}

function setOrbMode(mode) {
  orbMode = mode === "active" ? "active" : "idle";
}

async function loadTrades() {
  try {
    const userId = currentUserId || localStorage.getItem("user_id") || "aidenpasque11@gmail.com";
    const res = await fetch(`${API_TRADES}?user_id=eq.${encodeURIComponent(userId)}`);
    const data = await res.json().catch(() => ({}));
    console.log("FRONTEND RAW DATA:", data);
    if (!res.ok) {
      console.warn(readApiErrorMessage(data) || "Trades request failed");
      return;
    }
    const headers = Array.isArray(data.headers) ? data.headers : [];
    const records = Array.isArray(data.records) ? data.records : [];
    tradeData = { headers, records, snapshot: data.snapshot };
    console.log("FRONTEND RECORDS:", tradeData.records.length);
    tradesLoaded = true;
    renderSnapshot();
  } catch (e) {
    console.warn("Could not load trades", e);
  }
}

function updateSendEnabled() {
  if (els.chatSend) {
    els.chatSend.disabled = chatSending || !tradesLoaded;
  }
  if (els.chatInput) {
    els.chatInput.disabled = chatSending;
  }
}

async function sendChatMessage(text) {
  if (chatSending || !text.trim()) return;
  enterChatMode();
  console.log("JARVIS CHECK RECORDS:", tradeData?.records?.length);
  if (!tradeData?.records?.length) {
    const msg = "No trade data yet. Check the server and Supabase, then refresh the page.";
    chatMessages.push({ role: "error", content: msg });
    chatUiMessages.push({ role: "error", content: msg });
    renderChatHistory();
    return;
  }

  chatSending = true;
  setOrbMode("active");
  updateSendEnabled();

  const userMsg = { role: "user", content: text.trim() };
  chatMessages.push(userMsg);
  chatUiMessages.push(userMsg);
  persistChatMessages();
  renderChatHistory();

  const apiMessages = trimChatMessagesForApi(filterChatForApi(chatMessages));

  try {
    const tradesToSend = tradeData.records;

    const res = await fetch(API_CHAT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: currentUserId || localStorage.getItem("user_id") || "aidenpasque11@gmail.com",
        headers: tradeData.headers,
        trades: tradesToSend,
        messages: apiMessages,
        briefingMemory: "",
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(readApiErrorMessage(data) || `Server error (${res.status})`);
    }

    const reply = typeof data.reply === "string" ? data.reply : "";
    if (!reply.trim()) {
      throw new Error("Empty reply");
    }

    chatMessages.push({ role: "assistant", content: reply });
    chatUiMessages.push({ role: "assistant", content: reply });
    persistChatMessages();
    renderChatHistory();
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Something went wrong.";
    chatMessages.push({ role: "error", content: errMsg });
    chatUiMessages.push({ role: "error", content: errMsg });
    persistChatMessages();
    renderChatHistory();
    if (els.chatInput) els.chatInput.value = text;
  } finally {
    chatSending = false;
    setOrbMode("idle");
    updateSendEnabled();
    els.chatInput?.focus();
  }
}

els.form?.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.chatInput?.value?.trim() ?? "";
  if (els.chatInput) els.chatInput.value = "";
  sendChatMessage(text);
});

els.chatInput?.addEventListener("focus", () => enterChatMode());
els.chatInput?.addEventListener("input", () => {
  if ((els.chatInput?.value || "").trim()) enterChatMode();
});

/* --- Energy orb (canvas) --- */
function startOrb() {
  const canvas = els.orbCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const logicalW = canvas.width;
  const logicalH = canvas.height;
  canvas.style.width = `${logicalW}px`;
  canvas.style.height = `${logicalH}px`;
  canvas.width = Math.floor(logicalW * dpr);
  canvas.height = Math.floor(logicalH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let t = 0;
  const cx = logicalW / 2;
  const cy = logicalH / 2;
  const baseR = Math.min(logicalW, logicalH) * 0.28;

  function frame() {
    t += orbMode === "active" ? 0.18 : 0.028;

    const pulse = 0.5 + 0.5 * Math.sin(t);
    const surge = orbMode === "active" ? 1.35 + 0.12 * Math.sin(t * 3.2) : 1;
    const r = baseR * (0.92 + 0.1 * pulse) * surge;
    const glow = orbMode === "active" ? 0.55 + 0.25 * pulse : 0.22 + 0.12 * pulse;
    const coreBright = orbMode === "active" ? 0.95 : 0.45 + 0.2 * pulse;

    ctx.clearRect(0, 0, logicalW, logicalH);

    const outer = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4);
    outer.addColorStop(0, `rgba(240, 180, 41, ${0.15 * glow})`);
    outer.addColorStop(0.35, `rgba(78, 159, 255, ${0.12 * glow})`);
    outer.addColorStop(0.65, `rgba(78, 159, 255, ${0.04 * glow})`);
    outer.addColorStop(1, "rgba(10, 10, 15, 0)");

    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
    ctx.fill();

    const mid = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.15, 0, cx, cy, r * 1.4);
    mid.addColorStop(0, `rgba(240, 180, 41, ${0.55 * coreBright})`);
    mid.addColorStop(0.45, `rgba(78, 159, 255, ${0.5 * coreBright})`);
    mid.addColorStop(0.85, `rgba(78, 159, 255, ${0.15 * coreBright})`);
    mid.addColorStop(1, "rgba(10, 10, 15, 0)");

    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.1, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.55);
    core.addColorStop(0, `rgba(255, 240, 200, ${0.9 * coreBright})`);
    core.addColorStop(0.5, GOLD);
    core.addColorStop(1, BLUE);

    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    if (orbMode === "active") {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 + 0.1 * Math.sin(t * 4)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1.15 + 0.05 * Math.sin(t * 2.5)), 0, Math.PI * 2);
      ctx.stroke();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => {
  /* DPR / size could be re-read; keep simple — canvas fixed layout scales via CSS */
});

async function boot() {
  await ensureUserId();
  await fetch("/api/sync").catch(() => {});

  chatMessages = loadChatMessagesFromStorage();
  chatUiMessages = [];
  setUIMode("idle");
  renderSnapshot();
  updateSendEnabled();
  startOrb();
  setOrbMode("active");
  void loadTrades()
    .then(() => updateSendEnabled())
    .finally(() => setOrbMode("idle"));
  els.chatInput?.focus();
}

boot();
