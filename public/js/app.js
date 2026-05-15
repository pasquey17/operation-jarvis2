import { openLogTradeModal } from "/js/log-trade-modal.js";

const API_CHAT = "/api/chat";
const API_TRADES = "/api/trades";
const DEFAULT_USER_ID = "aidenpasque11@gmail.com";
const USER_MUM_ID = "spasque70@gmail.com";
const STORAGE_KEY_CHAT = "operationJarvis.chat.v1";
const CHAT_RECENT_TRADES = 15;
const MAX_CHAT_MESSAGES_API = 5;
const MAX_CHAT_MESSAGE_CHARS = 1800;
const MAX_CHAT_MESSAGES_STORED = 120;

/** Rotating home chat placeholder (sessionStorage advances each full page load). */
const CHAT_PLACEHOLDER_STORAGE_KEY = "jarvis_chat_placeholder_index";
const CHAT_PLACEHOLDER_EXAMPLES = [
  "Why did I lose my last trade?",
  "Walk me through my last trade.",
  "Am I overtrading on Fridays?",
  "Where is my edge breaking down this month?",
  "What was my worst trade this week?",
  "What pattern shows up before my best wins?",
  "Which session am I bleeding in — London or NY?",
  "Am I taking revenge trades after losses?",
  "One rule I keep breaking — what does my data say?",
  "How should I size the next session after yesterday's result?",
];

let currentUserId = DEFAULT_USER_ID;
let snapshotRequestSeq = 0;

function setUserId(userId) {
  currentUserId = userId;
  try {
    localStorage.setItem("jarvis_user", userId);
    localStorage.setItem("user_id", userId);
  } catch {}
}

function getStoredUserId() {
  const jarvisUser = (localStorage.getItem("jarvis_user") || "").trim();
  const storedUserId = (localStorage.getItem("user_id") || "").trim();
  return jarvisUser || storedUserId || DEFAULT_USER_ID;
}

function clearUserId() {
  try {
    localStorage.removeItem("jarvis_user");
    localStorage.removeItem("user_id");
  } catch {}
  currentUserId = DEFAULT_USER_ID;
}

function promptForUser() {
  return new Promise((resolve) => {
    const existing = (localStorage.getItem("jarvis_user") || localStorage.getItem("user_id") || "").trim();

    const style = document.createElement("style");
    style.textContent = `
      .jv-login-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.82);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }
      .jv-login-card {
        width: min(520px, calc(100vw - 44px));
        border-radius: 18px;
        border: 1px solid rgba(0, 191, 255, 0.22);
        background: rgba(0, 0, 0, 0.78);
        box-shadow:
          0 0 0 1px rgba(0, 191, 255, 0.08) inset,
          0 24px 90px rgba(0, 0, 0, 0.78);
        padding: 18px;
        color: rgba(255, 255, 255, 0.92);
        font-family: "Share Tech Mono","Courier New",monospace;
      }
      .jv-login-title {
        margin: 0 0 10px 0;
        font-size: 12px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgba(0, 191, 255, 0.85);
      }
      .jv-login-sub {
        margin: 0 0 14px 0;
        font-size: 10px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.32);
      }
      .jv-login-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-bottom: 12px;
      }
      .jv-login-btn {
        border-radius: 12px;
        border: 1px solid rgba(0, 191, 255, 0.28);
        background: rgba(0, 191, 255, 0.08);
        color: rgba(255, 255, 255, 0.9);
        padding: 12px 12px;
        cursor: pointer;
        font-family: inherit;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-size: 11px;
        transition: background 0.2s, border-color 0.2s, transform 0.2s;
      }
      .jv-login-btn:hover {
        background: rgba(0, 191, 255, 0.16);
        border-color: rgba(0, 191, 255, 0.6);
        transform: translateY(-1px);
      }
      .jv-login-input {
        width: 100%;
        box-sizing: border-box;
        border-radius: 12px;
        border: 1px solid rgba(0, 191, 255, 0.22);
        background: rgba(0, 0, 0, 0.45);
        color: rgba(255, 255, 255, 0.9);
        padding: 12px 12px;
        outline: none;
        font-family: inherit;
        letter-spacing: 0.04em;
      }
      .jv-login-input:focus {
        border-color: rgba(0, 191, 255, 0.7);
        box-shadow: 0 0 0 2px rgba(0, 191, 255, 0.12);
      }
      .jv-login-actions {
        display: flex;
        gap: 10px;
        margin-top: 12px;
        align-items: center;
        justify-content: flex-end;
      }
      .jv-login-continue {
        border-radius: 12px;
        border: 1px solid rgba(0, 191, 255, 0.65);
        background: rgba(0, 191, 255, 0.14);
        color: rgba(0, 191, 255, 0.95);
        padding: 10px 14px;
        cursor: pointer;
        font-family: inherit;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-size: 11px;
      }
    `;

    const overlay = document.createElement("div");
    overlay.className = "jv-login-overlay";

    const card = document.createElement("div");
    card.className = "jv-login-card";

    const title = document.createElement("h2");
    title.className = "jv-login-title";
    title.textContent = "LOGIN";

    const sub = document.createElement("p");
    sub.className = "jv-login-sub";
    sub.textContent = "Select user profile";

    const row = document.createElement("div");
    row.className = "jv-login-row";

    const btnAiden = document.createElement("button");
    btnAiden.type = "button";
    btnAiden.className = "jv-login-btn";
    btnAiden.textContent = "Aiden";

    const btnMum = document.createElement("button");
    btnMum.type = "button";
    btnMum.className = "jv-login-btn";
    btnMum.textContent = "Mum";

    const input = document.createElement("input");
    input.className = "jv-login-input";
    input.type = "email";
    input.autocomplete = "email";
    input.inputMode = "email";
    input.placeholder = "Or enter email…";
    input.value = existing;

    const actions = document.createElement("div");
    actions.className = "jv-login-actions";

    const cont = document.createElement("button");
    cont.type = "button";
    cont.className = "jv-login-continue";
    cont.textContent = "Continue";

    function submit(value) {
      const email = (value || "").trim() || DEFAULT_USER_ID;
      setUserId(email);
      overlay.remove();
      style.remove();
      resolve(email);
    }

    btnAiden.addEventListener("click", () => submit(DEFAULT_USER_ID));
    btnMum.addEventListener("click", () => submit(USER_MUM_ID));
    cont.addEventListener("click", () => submit(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit(input.value);
    });

    row.appendChild(btnAiden);
    row.appendChild(btnMum);
    actions.appendChild(cont);

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(row);
    card.appendChild(input);
    card.appendChild(actions);

    overlay.appendChild(card);

    document.head.appendChild(style);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

function ensureUserId() {
  const jarvisUser = (localStorage.getItem("jarvis_user") || "").trim();
  const storedUserId = (localStorage.getItem("user_id") || "").trim();

  if (jarvisUser) {
    setUserId(jarvisUser);
    if (storedUserId !== jarvisUser) {
      try {
        localStorage.setItem("user_id", jarvisUser);
      } catch {}
    }
    return Promise.resolve(jarvisUser);
  }

  if (storedUserId) {
    setUserId(storedUserId);
    return Promise.resolve(storedUserId);
  }

  return promptForUser();
}

function initLogoutButton() {
  const btn = document.getElementById("logout-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    clearUserId();
    // reload so the app re-initializes cleanly into the login prompt
    window.location.reload();
  });
}

/** Normalize /api/trades JSON (handles optional `payload` wrapper or bad shapes). */
function normalizeTradesApiBody(data) {
  if (!data || typeof data !== "object") {
    return { headers: [], records: [], snapshot: null, warning: "" };
  }
  const inner =
    data.payload != null && typeof data.payload === "object" ? data.payload : data;
  return {
    headers: Array.isArray(inner.headers) ? inner.headers : [],
    records: Array.isArray(inner.records) ? inner.records : [],
    snapshot:
      inner.snapshot != null && typeof inner.snapshot === "object"
        ? inner.snapshot
        : null,
    warning: typeof inner.warning === "string" ? inner.warning : "",
  };
}

let chatSending = false;
/** @type {{ role: string, content: string }[]} */
let chatMessages = [];
/** @type {{ role: string, content: string }[]} */
let chatUiMessages = [];

/** @type {{ headers: string[], records: Record<string,string>[] } | null} */
let tradeData = null;
let tradesLoaded = false;

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
    out.unshift({ role: trimmed[i].role, content: trimmed[i].content });
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
  els.chatScroll.scrollTo({ top: els.chatScroll.scrollHeight, behavior: "smooth" });
}

/** Strip accidental trailing punctuation captured after the URL in prose. */
function normalizeChatUrl(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/[)\].,;!?]+$/g, "");
  return s.trim();
}

function chatHttpsUrlIsInlineImage(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const blob = parsed.pathname + parsed.search;
    if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(blob)) return true;
    if (/\.amazonaws\.com$/i.test(parsed.hostname)) return true;
    if (/\.(notion\.so|notion\.site)$/i.test(parsed.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Same-origin proxy avoids broken thumbnails when S3 blocks foreign Referer (journal loads direct; chat needs this). */
function chatImageDisplayUrl(absUrl) {
  try {
    const parsed = new URL(absUrl);
    if (parsed.protocol !== "https:") return absUrl;
    const h = parsed.hostname.toLowerCase();
    if (
      h.endsWith(".amazonaws.com") ||
      h.endsWith(".notion.so") ||
      h.endsWith(".notion.site")
    ) {
      return `/api/proxy-image?u=${encodeURIComponent(absUrl)}`;
    }
  } catch {
    /* ignore */
  }
  return absUrl;
}

/**
 * Renders Jarvis text with trade screenshot HTTPS URLs shown as inline images (not raw links).
 * Thumbnails use /api/proxy-image on AWS/Notion; click opens the journal-style lightbox (no new tab).
 */
function fillJarvisMessageElement(el, rawText) {
  el.textContent = "";
  const text = rawText == null ? "" : String(rawText);
  if (!text) return;

  const urlRe = /https?:\/\/\S+/gi;
  let idx = 0;
  for (const match of text.matchAll(urlRe)) {
    const start = match.index ?? 0;
    if (start > idx) {
      el.appendChild(document.createTextNode(text.slice(idx, start)));
    }
    const url = normalizeChatUrl(match[0]);
    if (chatHttpsUrlIsInlineImage(url)) {
      const displaySrc = chatImageDisplayUrl(url);
      const wrap = document.createElement("div");
      wrap.className = "msg-inline-img-wrap";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "msg-inline-img-open";
      btn.setAttribute("data-src", displaySrc);
      btn.setAttribute("data-caption", "");
      btn.setAttribute("aria-label", "Expand chart");
      const img = document.createElement("img");
      img.src = displaySrc;
      img.alt = "";
      img.className = "msg-inline-img";
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      img.dataset.directSrc = url;
      img.addEventListener("error", function onImgErr() {
        if (!img.dataset.directSrc || img.src.indexOf("/api/proxy-image") === -1) return;
        img.removeEventListener("error", onImgErr);
        img.src = img.dataset.directSrc;
      });
      btn.appendChild(img);
      wrap.appendChild(btn);
      el.appendChild(wrap);
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "msg-inline-link";
      link.textContent = url.length > 56 ? `${url.slice(0, 53)}…` : url;
      el.appendChild(link);
    }
    idx = start + match[0].length;
  }
  if (idx < text.length) {
    el.appendChild(document.createTextNode(text.slice(idx)));
  }
}

function initChatImageLightbox() {
  const lb = document.getElementById("jn-lightbox");
  const imgEl = lb?.querySelector(".jn-lightbox__img");
  const capEl = document.getElementById("jn-lightbox-caption");
  const closeBtn = document.getElementById("jn-lightbox-close");
  const backdrop = document.getElementById("jn-lightbox-backdrop");
  if (!lb || !imgEl) return;

  function openChatLightbox(src, caption) {
    imgEl.src = src || "";
    imgEl.alt = caption ? caption : "Chart";
    if (capEl) {
      const c = caption ? String(caption).trim() : "";
      if (c) {
        capEl.textContent = c;
        capEl.removeAttribute("hidden");
      } else {
        capEl.textContent = "";
        capEl.setAttribute("hidden", "");
      }
    }
    lb.removeAttribute("hidden");
    lb.setAttribute("aria-hidden", "false");
    try {
      document.body.style.overflow = "hidden";
    } catch {
      /* ignore */
    }
    closeBtn?.focus();
  }

  function closeChatLightbox() {
    lb.setAttribute("hidden", "");
    lb.setAttribute("aria-hidden", "true");
    imgEl.src = "";
    try {
      document.body.style.overflow = "";
    } catch {
      /* ignore */
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".msg-inline-img-open");
    if (!btn) return;
    e.preventDefault();
    openChatLightbox(btn.getAttribute("data-src") || "", btn.getAttribute("data-caption") || "");
  });

  closeBtn?.addEventListener("click", closeChatLightbox);
  backdrop?.addEventListener("click", closeChatLightbox);

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (lb.hasAttribute("hidden")) return;
    closeChatLightbox();
  });
}

function jarvisReplyProbablyHasDisplayableUrl(txt) {
  return /https?:\/\/\S+/i.test(String(txt || ""));
}

/**
 * @param {{ animateLast?: boolean, streamLast?: boolean }} [options]
 */
function renderChatHistory(options) {
  const animateLast = Boolean(options?.animateLast);
  const streamLast = Boolean(options?.streamLast);
  if (!els.chatHistory) return;
  els.chatHistory.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < chatUiMessages.length; i++) {
    const m = chatUiMessages[i];
    const isLast = i === chatUiMessages.length - 1;
    const row = document.createElement("div");
    row.className =
      m.role === "user"
        ? "msg msg--user"
        : m.role === "error"
          ? "msg msg--error"
          : "msg msg--jarvis";
    if (m.role === "assistant") {
      if (streamLast && isLast) {
        row.textContent = "";
      } else {
        fillJarvisMessageElement(row, m.content);
      }
    } else {
      row.textContent = streamLast && isLast ? "" : m.content;
    }
    frag.appendChild(row);
  }
  els.chatHistory.appendChild(frag);

  const standby = document.getElementById("chat-standby");
  if (standby) standby.classList.toggle("hidden", chatUiMessages.length > 0);

  const last = els.chatHistory.lastElementChild;
  if (animateLast && last && !streamLast) {
    requestAnimationFrame(() => {
      last.classList.add("msg--enter");
      last.addEventListener("animationend", () => last.classList.remove("msg--enter"), {
        once: true,
      });
    });
  }

  scrollChatToBottom();
}

/** Stream text into an element word-by-word at ~40ms per word. */
function streamWords(text, element) {
  return new Promise((resolve) => {
    const words = text.split(" ");
    let i = 0;
    function next() {
      if (i >= words.length) {
        resolve();
        return;
      }
      element.textContent += (i === 0 ? "" : " ") + words[i];
      i++;
      scrollChatToBottom();
      setTimeout(next, 40);
    }
    next();
  });
}

function showTypingIndicator() {
  hideTypingIndicator();
  if (!els.chatHistory) return;
  const el = document.createElement("div");
  el.id = "typing-indicator";
  el.className = "typing-indicator";
  el.innerHTML =
    '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  els.chatHistory.appendChild(el);
  scrollChatToBottom();
}

function hideTypingIndicator() {
  document.getElementById("typing-indicator")?.remove();
}

/** Animate a numeric value in an element from 0 to target. */
function countUpEl(el, targetStr, durationMs = 700) {
  if (!el) return;
  const numMatch = String(targetStr).match(/^(-?\d+\.?\d*)/);
  if (!numMatch) { el.textContent = targetStr; return; }
  const target = parseFloat(numMatch[1]);
  const suffix = String(targetStr).slice(numMatch[1].length);
  if (isNaN(target)) { el.textContent = targetStr; return; }
  const start = performance.now();
  const decimals = (numMatch[1].includes(".") ? numMatch[1].split(".")[1].length : 0);
  function step(now) {
    const t = Math.min((now - start) / durationMs, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = (target * ease).toFixed(decimals) + suffix;
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = targetStr;
  }
  requestAnimationFrame(step);
}

function renderSnapshot() {
  if (tradeData?.loadError) {
    if (els.snapWinrate) els.snapWinrate.textContent = "—";
    if (els.snapAvgRR) els.snapAvgRR.textContent = "—";
    if (els.snapExpectancy) els.snapExpectancy.textContent = "—";
    if (els.snapTotal) els.snapTotal.textContent = "—";
    if (els.snapInsight) els.snapInsight.textContent = tradeData.loadError;
    return;
  }

  const s = tradeData?.snapshot;
  if (!s || typeof s !== "object") {
    if (els.snapWinrate) els.snapWinrate.textContent = "—";
    if (els.snapAvgRR) els.snapAvgRR.textContent = "—";
    if (els.snapExpectancy) els.snapExpectancy.textContent = "—";
    if (els.snapTotal) els.snapTotal.textContent = "—";
    if (els.snapInsight) {
      els.snapInsight.textContent = tradesLoaded ? "Syncing ledger…" : "Loading ledger…";
    }
    return;
  }

  countUpEl(els.snapTotal, String(s.total ?? "—"));
  countUpEl(els.snapWinrate, s.winRate == null ? "—" : `${Number(s.winRate).toFixed(1)}%`);
  countUpEl(els.snapAvgRR, s.avgRR == null ? "—" : Number(s.avgRR).toFixed(2));
  countUpEl(els.snapExpectancy, s.expectancy == null ? "—" : `${Number(s.expectancy).toFixed(2)}R`);
  if (els.snapInsight) {
    let line = s.bestSession
      ? `Edge clusters in ${s.bestSession}.`
      : "Session mix flat — no dominant window yet.";
    if (tradeData?.warning) {
      line = `${line} · ${tradeData.warning}`;
    }
    els.snapInsight.textContent = line;
  }
}

function getRecentTradesForChat(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  return records.slice(-CHAT_RECENT_TRADES);
}

/* ═══════════ Open greeting (STEP 1 — stats from loaded ledger only; no extra API calls) ═══════════ */

const MAX_OPEN_GREETING_CHARS = 720;

/** Adelaide weekday + daypart — matches server/journal date tone. */
function getAdelaideDayContext() {
  const now = new Date();
  let weekday = "Day";
  let hour = 12;
  try {
    const dtf = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Adelaide",
      weekday: "long",
      hour: "numeric",
      hour12: false,
    });
    const parts = dtf.formatToParts(now);
    for (const p of parts) {
      if (p.type === "weekday") weekday = p.value;
      if (p.type === "hour") hour = parseInt(p.value, 10) || 12;
    }
  } catch {
    weekday = now.toLocaleDateString(undefined, { weekday: "long" });
    hour = now.getHours();
  }
  const daypart = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return { weekday, daypart, hour };
}

function parseRecordDateMs(rec) {
  if (!rec || typeof rec !== "object") return NaN;
  const raw = rec.date || rec.Date || rec.traded_at || rec.TRADE_DATE || "";
  if (!raw) return NaN;
  const t = new Date(String(raw).trim().replace(/\s+/, "T"));
  const ms = t.getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function normOutcomeGreeting(val) {
  const s = String(val || "").trim().toUpperCase();
  if (!s) return "";
  if (s === "WIN" || s === "W") return "WIN";
  if (s === "LOSS" || s === "L") return "LOSS";
  if (s === "BE" || s.includes("BREAK")) return "BE";
  return s;
}

function sortedTradeRecordsDesc(records) {
  return [...records].sort((a, b) => parseRecordDateMs(b) - parseRecordDateMs(a));
}

/** Consecutive losses from the newest trade backward (requires date sort). */
function lossStreakFromNewest(sortedDesc) {
  let n = 0;
  for (const r of sortedDesc) {
    if (normOutcomeGreeting(r.outcome ?? r.Outcome) === "LOSS") n += 1;
    else break;
  }
  return n;
}

/**
 * One open-screen line set: weekday + snapshot + newest row + one grounded "watch it".
 * Uses only `tradeData` already returned from GET /api/trades (no Anthropic call).
 */
function buildSmartOpenGreeting(td) {
  const { weekday, daypart } = getAdelaideDayContext();
  const capDay = weekday.charAt(0).toUpperCase() + weekday.slice(1);

  if (!td || td.loadError) {
    return `${capDay} ${daypart} — core online, but the ledger did not load. Refresh once; if it persists, check sync.`;
  }

  const recs = Array.isArray(td.records) ? td.records : [];
  if (!recs.length) {
    return `${capDay} ${daypart} — core online. Book is empty on this profile; log a trade or sync Notion, then we anchor to it.`;
  }

  const snap = td.snapshot != null && typeof td.snapshot === "object" ? td.snapshot : null;
  const sorted = sortedTradeRecordsDesc(recs);
  const latest = sorted[0];
  const streak = lossStreakFromNewest(sorted);

  const total =
    snap && snap.total != null && Number.isFinite(Number(snap.total))
      ? Number(snap.total)
      : recs.length;
  const winRate =
    snap && snap.winRate != null && Number.isFinite(Number(snap.winRate))
      ? Number(snap.winRate)
      : null;
  const expectancy =
    snap && snap.expectancy != null && Number.isFinite(Number(snap.expectancy))
      ? Number(snap.expectancy)
      : null;
  const bestSession = snap && snap.bestSession ? String(snap.bestSession).trim() : "";

  const lines = [];
  lines.push(`${capDay} ${daypart} — core online.`);

  if (winRate != null) {
    lines.push(`Book: ${total} trades · win rate ${winRate.toFixed(1)}%.`);
  } else {
    lines.push(`Book: ${total} trades.`);
  }

  if (latest) {
    const o = normOutcomeGreeting(latest.outcome ?? latest.Outcome);
    const pair = String(latest.pair ?? latest.Pair ?? "")
      .trim()
      .toUpperCase() || "—";
    const sess = String(latest.session ?? latest.Session ?? "").trim();
    const oLabel = o === "WIN" ? "WIN" : o === "LOSS" ? "LOSS" : o === "BE" ? "BE" : o || "—";
    lines.push(
      sess ? `Newest line: ${sess} · ${pair} → ${oLabel}.` : `Newest line: ${pair} → ${oLabel}.`
    );
  }

  let watch = "";
  if (streak >= 2 && total >= 2) {
    watch = `Watch it: ${streak} losses at the top of the book — size down or restate the rule before the next entry.`;
  } else if (expectancy != null && expectancy < 0 && total >= 8) {
    watch =
      "Watch it: expectancy is negative across the sample — fewer trades until one leak is fixed.";
  } else if (winRate != null && winRate < 40 && total >= 6) {
    watch = "Watch it: win rate is soft on this volume — A+ setups only until the stats lift.";
  } else if (weekday.toLowerCase() === "friday" && total >= 5) {
    watch =
      "Watch it: Friday — match size to focus; sloppy execution shows up fast in the log.";
  } else if (bestSession && total >= 8) {
    watch = `Context: most trades sit in ${bestSession} — confirm that's edge, not autopilot volume.`;
  } else {
    watch =
      "Pick one lane — last loss, session, or a single stat — and we'll run it tight to the numbers.";
  }

  lines.push(watch);

  if (typeof td.warning === "string" && td.warning.trim()) {
    lines.push(`Note: ${td.warning.trim()}`);
  }

  let out = lines.join(" ");
  if (out.length > MAX_OPEN_GREETING_CHARS) {
    out = `${out.slice(0, MAX_OPEN_GREETING_CHARS - 1).trimEnd()}…`;
  }
  return out;
}

async function showGreeting() {
  if (chatMessages.length > 0) return;
  const text = buildSmartOpenGreeting(tradeData);
  chatUiMessages.push({ role: "assistant", content: text });
  setUIMode("chat");
  renderChatHistory({ streamLast: true });
  const lastEl = els.chatHistory?.lastElementChild;
  if (lastEl && jarvisReplyProbablyHasDisplayableUrl(text)) {
    fillJarvisMessageElement(lastEl, text);
    scrollChatToBottom();
  } else if (lastEl) {
    // speakText(text);
    await streamWords(text, lastEl);
  }
}

/* ═══════════ Deep space star field ═══════════ */
let particleMode = "idle";
const STAR_COUNT = 150;
const stars = [];
const shootingStars = [];
let shootNextAt = 90;

class Star {
  constructor() {
    this.x = Math.random() * window.innerWidth;
    this.y = Math.random() * window.innerHeight;
    this.size = Math.random() * 0.9 + 0.2;
    this.baseAlpha = Math.random() * 0.5 + 0.15;
    this.alpha = this.baseAlpha;
    this.twinkleSpeed = 0.003 + Math.random() * 0.012;
    this.twinklePhase = Math.random() * Math.PI * 2;
    const r = Math.random();
    if (r < 0.65)      { this.cr = 210; this.cg = 228; this.cb = 255; }
    else if (r < 0.88) { this.cr = 255; this.cg = 255; this.cb = 255; }
    else               { this.cr = 120; this.cg = 200; this.cb = 255; }
  }
  update() {
    this.twinklePhase += this.twinkleSpeed;
    this.alpha = this.baseAlpha * (0.5 + 0.5 * Math.sin(this.twinklePhase));
  }
  draw(ctx) {
    const a = Math.max(0, Math.min(1, this.alpha));
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgb(${this.cr},${this.cg},${this.cb})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class ShootingStar {
  constructor() {
    this.x = Math.random() * window.innerWidth * 0.7 + window.innerWidth * 0.05;
    this.y = Math.random() * window.innerHeight * 0.5;
    const angle = 0.4 + Math.random() * 0.6;
    const spd = 6 + Math.random() * 5;
    this.vx = Math.cos(angle) * spd;
    this.vy = Math.sin(angle) * spd;
    this.tailLen = 100;
    this.life = 0;
    this.maxLife = 27;
    this.alive = true;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life++;
    if (this.life >= this.maxLife) this.alive = false;
  }
  draw(ctx) {
    const progress = this.life / this.maxLife;
    const a = 0.7 * (1 - progress);
    const hyp = Math.hypot(this.vx, this.vy) || 1;
    const tailX = this.x - (this.vx / hyp) * this.tailLen;
    const tailY = this.y - (this.vy / hyp) * this.tailLen;
    const g = ctx.createLinearGradient(tailX, tailY, this.x, this.y);
    g.addColorStop(0, `rgba(200,240,255,0)`);
    g.addColorStop(0.6, `rgba(220,245,255,${a * 0.5})`);
    g.addColorStop(1, `rgba(255,255,255,${a})`);
    ctx.save();
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(this.x, this.y);
    ctx.stroke();
    ctx.restore();
  }
}

function getOrbCenter() {
  const c = document.getElementById("orb-canvas");
  if (!c) return { x: window.innerWidth * 0.22, y: window.innerHeight * 0.5 };
  const rect = c.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function initParticles() {
  const pCanvas = document.getElementById("particle-canvas");
  if (!pCanvas) return;
  const pCtx = pCanvas.getContext("2d");

  function resize() {
    pCanvas.width = window.innerWidth;
    pCanvas.height = window.innerHeight;
    stars.length = 0;
    for (let i = 0; i < STAR_COUNT; i++) stars.push(new Star());
  }
  resize();
  window.addEventListener("resize", resize);

  // Single nebula — three gradients were the main perf cost
  const nebula = { x: 0.25, y: 0.45, r: 0.55, cr: 55, cg: 0, cb: 135, a: 0.055 };
  let nebulaT = 0;

  function drawNebula() {
    nebulaT += 0.0006;
    const pulse = 1 + 0.1 * Math.sin(nebulaT * 1.9);
    const nx = nebula.x * pCanvas.width;
    const ny = nebula.y * pCanvas.height;
    const nr = nebula.r * Math.max(pCanvas.width, pCanvas.height) * pulse;
    const g = pCtx.createRadialGradient(nx, ny, 0, nx, ny, nr);
    g.addColorStop(0, `rgba(${nebula.cr},${nebula.cg},${nebula.cb},${nebula.a * pulse})`);
    g.addColorStop(1, `rgba(${nebula.cr},${nebula.cg},${nebula.cb},0)`);
    pCtx.fillStyle = g;
    pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);
  }

  // 30fps cap — target ~33ms between frames
  const SPACE_FRAME_MS = 1000 / 30;
  let lastSpaceFrame = 0;
  let frameCount = 0;

  function loop(now) {
    if (now - lastSpaceFrame < SPACE_FRAME_MS) {
      requestAnimationFrame(loop);
      return;
    }
    lastSpaceFrame = now;
    pCtx.fillStyle = "#050a14";
    pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);
    drawNebula();
    for (const s of stars) {
      s.update();
      s.draw(pCtx);
    }
    // Shooting stars every 12–20 s at 30fps
    if (frameCount > shootNextAt && shootingStars.length < 1) {
      shootNextAt = frameCount + (15 + Math.random() * 10) * 30;
      shootingStars.push(new ShootingStar());
      console.log("shooting star fired");
    }
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const ss = shootingStars[i];
      ss.update();
      ss.draw(pCtx);
      if (!ss.alive) shootingStars.splice(i, 1);
    }
    frameCount++;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

/* ═══════════ Orb mode ═══════════ */
function setOrbMode(mode) {
  const prev = orbMode;
  orbMode = mode === "active" ? "active" : "idle";

  const mount = document.querySelector(".orb-mount");
  if (mount) mount.classList.toggle("orb--active", orbMode === "active");

  if (orbMode === "active") {
    particleMode = "active";
  } else if (prev === "active") {
    particleMode = "scatter";
    setTimeout(() => {
      if (orbMode === "idle") particleMode = "idle";
    }, 1500);
  } else {
    particleMode = "idle";
  }
}

/* ═══════════ Text-to-speech — English male voice priority ═══════════ */
let voiceEnabled = true;
let selectedVoice = null;

function initVoice() {
  function pickVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const enVoices = voices.filter(
      (v) => v.lang && v.lang.toLowerCase().startsWith("en")
    );
    const notFemale = (v) =>
      !v.name.toLowerCase().includes("female") &&
      !v.name.toLowerCase().includes("zira") &&
      !v.name.toLowerCase().includes("hazel") &&
      !v.name.toLowerCase().includes("susan") &&
      !v.name.toLowerCase().includes("helen") &&
      !v.name.toLowerCase().includes("linda") &&
      !v.name.toLowerCase().includes("karen") &&
      !v.name.toLowerCase().includes("samantha") &&
      !v.name.toLowerCase().includes("victoria");

    selectedVoice =
      voices.find((v) => v.name === "Google UK English Male") ||
      voices.find((v) => v.name === "Microsoft David Desktop - English (United States)") ||
      voices.find((v) => v.name.includes("Microsoft David")) ||
      voices.find(
        (v) =>
          v.name.toLowerCase().includes("male") &&
          v.lang.toLowerCase().startsWith("en")
      ) ||
      enVoices.find(
        (v) => v.lang.toLowerCase().startsWith("en-gb") && notFemale(v)
      ) ||
      enVoices.find(
        (v) => v.lang.toLowerCase().startsWith("en-us") && notFemale(v)
      ) ||
      enVoices.find(notFemale) ||
      enVoices[0] ||
      null;
  }
  pickVoice();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }
}

function speakText(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;
  // window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  if (selectedVoice) utter.voice = selectedVoice;
  utter.lang = "en-GB";
  utter.rate = 0.85;
  utter.pitch = 0.9;
  utter.volume = 1;
  utter.onstart = () => {
    const mount = document.querySelector(".orb-mount");
    if (mount) mount.classList.add("orb--active");
  };
  utter.onend = utter.onerror = () => {
    const mount = document.querySelector(".orb-mount");
    if (mount && orbMode !== "active") mount.classList.remove("orb--active");
  };
  // window.speechSynthesis.speak(utter);
}

function initMuteButton() {
  const btn = document.getElementById("mute-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    btn.classList.toggle("muted", !voiceEnabled);
    btn.setAttribute("aria-label", voiceEnabled ? "Mute voice" : "Unmute voice");
    if (!voiceEnabled) window.speechSynthesis?.cancel?.();
  });
}

/* ═══════════ Microphone — push to talk ═══════════ */
function initMic() {
  const btn = document.getElementById("mic-btn");
  if (!btn) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.style.display = "none";
    return;
  }

  const recognition = new SR();
  recognition.lang = "en-GB";
  recognition.continuous = false;
  recognition.interimResults = false;

  let listening = false;

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results)
      .map((r) => r[0].transcript)
      .join(" ")
      .trim();
    if (els.chatInput && transcript) {
      els.chatInput.value = transcript;
      enterChatMode();
      els.chatInput.focus();
    }
  };

  recognition.onend = () => {
    listening = false;
    btn.classList.remove("mic--active");
  };

  recognition.onerror = () => {
    listening = false;
    btn.classList.remove("mic--active");
  };

  btn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
        listening = true;
        btn.classList.add("mic--active");
      } catch (e) {
        console.warn("Speech recognition failed to start", e);
      }
    }
  });
}

/* ═══════════ Trade data ═══════════ */
async function loadTradesAttempt() {
  const userId =
    currentUserId ||
    localStorage.getItem("jarvis_user") ||
    localStorage.getItem("user_id") ||
    DEFAULT_USER_ID;
  if (els.snapInsight) {
    els.snapInsight.textContent = "Fetching ledger…";
  }
  const res = await fetch(`${API_TRADES}?user_id=eq.${encodeURIComponent(userId)}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  console.log("FRONTEND RAW DATA:", data);

  if (!res.ok) {
    const msg =
      readApiErrorMessage(data) || `Could not load trades (${res.status}). Pull to refresh or try again.`;
    tradeData = {
      headers: [],
      records: [],
      snapshot: null,
      loadError: msg,
    };
    tradesLoaded = false;
    renderSnapshot();
    updateSendEnabled();
    throw new Error(msg);
  }

  const normalized = normalizeTradesApiBody(data);
  tradeData = {
    headers: normalized.headers,
    records: normalized.records,
    snapshot: normalized.snapshot,
    ...(normalized.warning ? { warning: normalized.warning } : {}),
  };
  console.log("FRONTEND RECORDS:", tradeData.records.length);
  tradesLoaded = true;
  renderSnapshot();
  updateSendEnabled();
}

async function loadTrades() {
  const maxAttempts = 4;
  const delayMs = 600;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await loadTradesAttempt();
      return;
    } catch (e) {
      console.warn(`loadTrades attempt ${attempt}/${maxAttempts}`, e);
      if (attempt === maxAttempts) return;
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
}

function updateSendEnabled() {
  if (els.chatSend) {
    const blocked = Boolean(tradeData?.loadError);
    els.chatSend.disabled = chatSending || !tradesLoaded || blocked;
  }
  if (els.chatInput) {
    els.chatInput.disabled = chatSending;
  }
}

function initChatRotatingPlaceholder() {
  if (!els.chatInput) return;
  const n = CHAT_PLACEHOLDER_EXAMPLES.length;
  let idx = 0;
  try {
    const raw = sessionStorage.getItem(CHAT_PLACEHOLDER_STORAGE_KEY);
    if (raw != null && raw !== "") {
      const parsed = parseInt(raw, 10);
      idx = Number.isFinite(parsed) ? ((parsed % n) + n) % n : 0;
    } else {
      idx = 0;
    }
  } catch {
    idx = Math.floor(Math.random() * n);
  }
  els.chatInput.placeholder = CHAT_PLACEHOLDER_EXAMPLES[idx];
  try {
    sessionStorage.setItem(CHAT_PLACEHOLDER_STORAGE_KEY, String((idx + 1) % n));
  } catch {
    /* ignore quota / private mode */
  }
}

const SESSION_PENDING_JARVIS = "jarvis_pending_message";

/** Journal → Home: auto-send trade analysis after trades load (sessionStorage set by journal.html). */
async function maybeFlushPendingJournalAsk() {
  let pending = "";
  try {
    pending = sessionStorage.getItem(SESSION_PENDING_JARVIS) || "";
  } catch {
    return false;
  }
  if (!pending.trim()) return false;
  if (tradeData?.loadError || !tradeData?.records?.length) return false;
  try {
    sessionStorage.removeItem(SESSION_PENDING_JARVIS);
  } catch {}
  const msg = truncateChatContent(pending.trim());
  await sendChatMessage(msg);
  return true;
}

async function sendChatMessage(text) {
  if (chatSending || !text.trim()) return;
  enterChatMode();
  console.log("JARVIS CHECK RECORDS:", tradeData?.records?.length);
  if (tradeData?.loadError) {
    const msg = tradeData.loadError;
    chatMessages.push({ role: "error", content: msg });
    chatUiMessages.push({ role: "error", content: msg });
    renderChatHistory({ animateLast: true });
    return;
  }
  if (!tradeData?.records?.length) {
    const msg = "No trade data yet. Check the server and Supabase, then refresh the page.";
    chatMessages.push({ role: "error", content: msg });
    chatUiMessages.push({ role: "error", content: msg });
    renderChatHistory({ animateLast: true });
    return;
  }

  chatSending = true;
  setOrbMode("active");
  const orbMount = document.querySelector(".orb-mount");
  if (orbMount) {
    orbMount.classList.add("orb--flash");
    orbMount.addEventListener("animationend", () => orbMount.classList.remove("orb--flash"), { once: true });
  }
  updateSendEnabled();

  const userMsg = { role: "user", content: text.trim() };
  chatMessages.push(userMsg);
  chatUiMessages.push(userMsg);
  persistChatMessages();
  renderChatHistory({ animateLast: true });

  showTypingIndicator();

  const apiMessages = trimChatMessagesForApi(filterChatForApi(chatMessages));

  try {
    const res = await fetch(API_CHAT, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email:
          currentUserId ||
          localStorage.getItem("jarvis_user") ||
          localStorage.getItem("user_id") ||
          DEFAULT_USER_ID,
        headers: tradeData.headers,
        trades: tradeData.records,
        messages: apiMessages,
        briefingMemory: "",
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(readApiErrorMessage(data) || `Server error (${res.status})`);
    }

    const reply = typeof data.reply === "string" ? data.reply : "";
    if (!reply.trim()) throw new Error("Empty reply");

    hideTypingIndicator();
    chatMessages.push({ role: "assistant", content: reply });
    chatUiMessages.push({ role: "assistant", content: reply });
    persistChatMessages();

    renderChatHistory({ streamLast: true });
    const lastEl = els.chatHistory?.lastElementChild;
    // speakText(reply);
    if (lastEl && jarvisReplyProbablyHasDisplayableUrl(reply)) {
      fillJarvisMessageElement(lastEl, reply);
      scrollChatToBottom();
    } else if (lastEl) {
      await streamWords(reply, lastEl);
    }
  } catch (e) {
    hideTypingIndicator();
    const errMsg = e instanceof Error ? e.message : "Something went wrong.";
    chatMessages.push({ role: "error", content: errMsg });
    chatUiMessages.push({ role: "error", content: errMsg });
    persistChatMessages();
    renderChatHistory({ animateLast: true });
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

/* ═══════════ Nucleus-cell orb — volumetric shells only, no wireframe lines (2D canvas) ═══════════ */
function startOrb() {
  const canvas = els.orbCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const BLUE = [0, 212, 255];
  const BLUE_DEEP = [0, 75, 165];
  const BLUE_HOT = [215, 252, 255];
  const PI2 = Math.PI * 2;

  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let logicalW = 0;
  let logicalH = 0;
  let cx = 0;
  let cy = 0;
  let projScale = 1;
  let timeSec = 0;
  let lastFrameTs = performance.now();
  /** Smoothed 0–1 “reply energy” — eases orb reaction when chat is active (no snap). */
  let orbEnergy = 0;

  let hullN = 0;
  let interiorN = 0;
  let mistN = 0;
  let nucleusN = 0;
  let shellN = 0;
  let strayN = 0;
  let coronaN = 0;
  let hullX,
    hullY,
    hullZ,
    interiorX,
    interiorY,
    interiorZ,
    mistX,
    mistY,
    mistZ,
    nucleusX,
    nucleusY,
    nucleusZ,
    shellX,
    shellY,
    shellZ,
    strayX,
    strayY,
    strayZ,
    coronaX,
    coronaY,
    coronaZ;

  function phasor(i, salt) {
    const t = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453123;
    return t - Math.floor(t);
  }

  let cloudCacheKey = "";

  const N_BUCK = 24;
  const dotBuckets = Array.from({ length: N_BUCK }, () => []);

  /** Cheap rotating “turbulence” for cloudy density (no textures; GPU-friendly). */
  function cloudDensity(wx, wy, wz, t, energy) {
    const tt = t * (0.28 + 0.27 * energy);
    let n =
      Math.sin(wx * 4.15 + wy * 2.08 + wz * 3.31 + tt * 1.1) *
        Math.cos(wy * 3.62 - wz * 4.08 + tt * 0.72) *
        0.55 +
      Math.sin(wx * 8.22 + wz * 6.05 + tt * 0.65) * 0.28 +
      Math.cos(wz * 7.41 + wx * 5.13 + wy * 2.77 + tt * 0.48) * 0.22 +
      Math.sin((wx + wy + wz) * 2.91 + tt * 0.38) * 0.18;
    const shaped = 0.5 + 0.5 * Math.sin(n * 2.17);
    return 0.38 + 0.62 * Math.pow(Math.max(0, Math.min(1, shaped)), 1.35);
  }

  function computeCloudBudget() {
    const m = Math.min(logicalW, logicalH);
    const area = logicalW * logicalH;
    if (area < 150000 || m < 300) {
      return {
        hull: 240,
        shell: 380,
        interior: 220,
        nucleus: 115,
        stray: 40,
        corona: 140,
      };
    }
    if (area < 320000 || m < 420) {
      return {
        hull: 380,
        shell: 660,
        interior: 400,
        nucleus: 185,
        stray: 75,
        corona: 260,
      };
    }
    if (area < 700000) {
      return {
        hull: 520,
        shell: 980,
        interior: 580,
        nucleus: 260,
        stray: 105,
        corona: 400,
      };
    }
    return {
      hull: 680,
      shell: 1320,
      interior: 760,
      nucleus: 320,
      stray: 145,
      corona: 560,
    };
  }

  function fibonacciSpherePoint(i, n, outX, outY, outZ, scale) {
    const t = (i + 0.5) / n;
    const phi = Math.acos(1 - 2 * t);
    const theta = PI2 * (1 + Math.sqrt(5)) * (i + 0.5);
    const sinp = Math.sin(phi);
    const fx = sinp * Math.cos(theta);
    const fy = sinp * Math.sin(theta);
    const fz = Math.cos(phi);
    const j = 0.985 + phasor(i, 44) * 0.03;
    outX[i] = fx * scale * j;
    outY[i] = fy * scale * j;
    outZ[i] = fz * scale * j;
  }

  function rebuildPointCloudModels() {
    const b = computeCloudBudget();
    const key = `${b.hull}|${b.shell}|${b.interior}|${b.nucleus}|${b.stray}|${b.corona}`;
    if (key === cloudCacheKey && hullX?.length === b.hull) return;
    cloudCacheKey = key;

    hullN = b.hull;
    interiorN = b.interior;
    mistN = Math.floor(interiorN * 0.48);
    nucleusN = b.nucleus;
    shellN = b.shell;
    strayN = b.stray;
    coronaN = b.corona;

    hullX = new Float32Array(hullN);
    hullY = new Float32Array(hullN);
    hullZ = new Float32Array(hullN);
    for (let i = 0; i < hullN; i++) fibonacciSpherePoint(i, hullN, hullX, hullY, hullZ, 1);

    const numLayers = Math.min(6, Math.max(4, Math.floor(shellN / 180)));
    const perLayer = Math.floor(shellN / numLayers);
    shellX = new Float32Array(shellN);
    shellY = new Float32Array(shellN);
    shellZ = new Float32Array(shellN);
    let si = 0;
    for (let li = 0; li < numLayers && si < shellN; li++) {
      const rBase = 0.36 + (li / Math.max(1, numLayers - 1)) * 0.52;
      const count = li === numLayers - 1 ? shellN - si : perLayer;
      for (let k = 0; k < count && si < shellN; k++, si++) {
        const t = (k + 0.5) / count;
        const phi = Math.acos(1 - 2 * t);
        const theta = PI2 * (1 + Math.sqrt(5)) * (k + li * 997);
        const sinp = Math.sin(phi);
        const fx = sinp * Math.cos(theta);
        const fy = sinp * Math.sin(theta);
        const fz = Math.cos(phi);
        const jitter = 0.96 + phasor(si, 17 + li) * 0.08;
        const rad = rBase * jitter;
        shellX[si] = fx * rad;
        shellY[si] = fy * rad;
        shellZ[si] = fz * rad;
      }
    }

    interiorX = new Float32Array(interiorN);
    interiorY = new Float32Array(interiorN);
    interiorZ = new Float32Array(interiorN);
    for (let i = 0; i < interiorN; i++) {
      const u = phasor(i, 2) * 2 - 1;
      const th = phasor(i, 5) * PI2;
      const rPow = Math.pow(phasor(i, 8), 0.62);
      const rad = 0.12 + rPow * 0.84;
      const rr = Math.sqrt(Math.max(0, 1 - u * u)) * rad;
      interiorX[i] = rr * Math.cos(th);
      interiorY[i] = rr * Math.sin(th);
      interiorZ[i] = u * rad;
    }

    mistX = new Float32Array(mistN);
    mistY = new Float32Array(mistN);
    mistZ = new Float32Array(mistN);
    for (let i = 0; i < mistN; i++) {
      const u = phasor(i + 4000, 2) * 2 - 1;
      const th = phasor(i + 4000, 5) * PI2;
      const rad = 0.22 + Math.pow(phasor(i + 4000, 8), 0.48) * 0.72;
      const rr = Math.sqrt(Math.max(0, 1 - u * u)) * rad;
      mistX[i] = rr * Math.cos(th);
      mistY[i] = rr * Math.sin(th);
      mistZ[i] = u * rad;
    }

    nucleusX = new Float32Array(nucleusN);
    nucleusY = new Float32Array(nucleusN);
    nucleusZ = new Float32Array(nucleusN);
    for (let i = 0; i < nucleusN; i++) {
      const u = phasor(i + 900, 1) * 2 - 1;
      const th = phasor(i + 900, 4) * PI2;
      const rad = 0.03 + phasor(i + 900, 7) * 0.26;
      const rr = Math.sqrt(Math.max(0, 1 - u * u)) * rad;
      nucleusX[i] = rr * Math.cos(th);
      nucleusY[i] = rr * Math.sin(th);
      nucleusZ[i] = u * rad;
    }

    strayX = new Float32Array(strayN);
    strayY = new Float32Array(strayN);
    strayZ = new Float32Array(strayN);
    for (let i = 0; i < strayN; i++) {
      const u = phasor(i + 1200, 3) * 2 - 1;
      const th = phasor(i + 1200, 6) * PI2;
      const rad = 1.02 + phasor(i + 1200, 9) * 0.14;
      const rr = Math.sqrt(Math.max(0, 1 - u * u)) * rad;
      strayX[i] = rr * Math.cos(th);
      strayY[i] = rr * Math.sin(th);
      strayZ[i] = u * rad;
    }

    coronaX = new Float32Array(coronaN);
    coronaY = new Float32Array(coronaN);
    coronaZ = new Float32Array(coronaN);
    for (let i = 0; i < coronaN; i++) {
      const t = (i + 0.5) / coronaN;
      const phi = Math.acos(1 - 2 * t);
      const theta = PI2 * (1 + Math.sqrt(5)) * (i + 33);
      const sinp = Math.sin(phi);
      const fx = sinp * Math.cos(theta);
      const fy = sinp * Math.sin(theta);
      const fz = Math.cos(phi);
      const shell = 1.01 + phasor(i + 2400, 1) * 0.11;
      coronaX[i] = fx * shell;
      coronaY[i] = fy * shell;
      coronaZ[i] = fz * shell;
    }
  }

  function clearDotBuckets() {
    for (let b = 0; b < N_BUCK; b++) dotBuckets[b].length = 0;
  }

  function bucketPush(sz, sx, sy, radius, alpha) {
    let bi = Math.floor(((sz + 1) * 0.5) * N_BUCK);
    if (bi < 0) bi = 0;
    if (bi >= N_BUCK) bi = N_BUCK - 1;
    dotBuckets[bi].push(sx, sy, radius, alpha);
  }

  function fillPointBuckets(rx, ry, rz, e) {
    const tw = 1 + 0.38 * e;
    const flick = reducedMotion ? 0 : Math.sin(timeSec * (0.68 + 0.42 * e));
    const tNoise = timeSec * (0.45 + 0.45 * e);

    function spinPoint(x, y, z) {
      return eulerRotate(x, y, z, rx, ry, rz);
    }

    /** Outer corona — soft fuzzy edge (no hard rim) */
    for (let i = 0; i < coronaN; i++) {
      const px = spinPoint(coronaX[i], coronaY[i], coronaZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      const dens = cloudDensity(coronaX[i], coronaY[i], coronaZ[i], tNoise, e);
      let a =
        (0.018 + frontal * 0.11 + phasor(i, 701) * 0.04) * dens * tw * (1 + 0.28 * e);
      const rad =
        (0.85 + frontal * 1.55 + phasor(i, 801) * 0.65) * (1.02 + 0.04 * e);
      bucketPush(sz, sx, sy, rad, Math.min(0.42, Math.max(0.015, a)));
    }

    for (let i = 0; i < strayN; i++) {
      const px = spinPoint(strayX[i], strayY[i], strayZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a = (0.028 + frontal * 0.12 + phasor(i, 501) * 0.055) * tw * (1 + 0.35 * e);
      const rad = (0.32 + frontal * 0.62 + phasor(i, 602) * 0.42) * (1 + 0.08 * e);
      bucketPush(sz, sx, sy, rad, Math.min(0.36, Math.max(0.02, a)));
    }

    for (let i = 0; i < mistN; i++) {
      const dens = cloudDensity(mistX[i], mistY[i], mistZ[i], tNoise, e);
      const px = spinPoint(mistX[i], mistY[i], mistZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a =
        (0.03 + frontal * 0.26 + Math.sqrt(phasor(i + 8000, 91)) * 0.09) *
        dens *
        tw *
        (0.92 + 0.36 * e);
      const rad =
        (0.38 + frontal * 0.82 + phasor(i + 8000, 71) * 0.48) * (1 + 0.08 * e);
      bucketPush(sz, sx, sy, rad, Math.min(0.62, Math.max(0.02, a)));
    }

    for (let i = 0; i < interiorN; i++) {
      const dens = cloudDensity(interiorX[i], interiorY[i], interiorZ[i], tNoise, e);
      const px = spinPoint(interiorX[i], interiorY[i], interiorZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a =
        (0.032 + frontal * 0.26 + Math.sqrt(phasor(i, 91)) * 0.08) *
        dens *
        tw *
        (0.9 + 0.35 * e);
      const rad =
        (0.32 + frontal * 0.74 + phasor(i, 71) * 0.42) * (0.98 + 0.08 * e);
      bucketPush(sz, sx, sy, rad, Math.min(0.62, Math.max(0.02, a)));
    }

    for (let i = 0; i < shellN; i++) {
      const dens = cloudDensity(shellX[i], shellY[i], shellZ[i], tNoise, e);
      const px = spinPoint(shellX[i], shellY[i], shellZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      const dist = Math.hypot(shellX[i], shellY[i], shellZ[i]) || 0.01;
      const shellFac = Math.max(0, Math.min(1, (dist - 0.32) / 0.68));
      let a =
        (0.065 + frontal * 0.4 * (0.35 + shellFac * 0.65) + (phasor(i, 3) - 0.5) * 0.035) *
        dens *
        tw;
      a += frontal * (flick * (0.009 + 0.007 * e) + 0.048 * e);
      const rad =
        (0.34 + frontal * (0.88 + shellFac * 0.58) + phasor(i, 99) * 0.14) * (1 + 0.05 * e);
      bucketPush(sz, sx, sy, rad, Math.min(0.88, Math.max(0.035, a)));
    }

    for (let i = 0; i < hullN; i++) {
      const dens = cloudDensity(hullX[i], hullY[i], hullZ[i], tNoise * 0.85, e);
      const px = spinPoint(hullX[i], hullY[i], hullZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a =
        (0.09 + frontal * 0.38 + (phasor(i, 11) - 0.5) * 0.038) * (0.72 + dens * 0.28) * tw;
      a += frontal * (flick * (0.012 + 0.008 * e) + 0.053 * e);
      const rad =
        (0.42 + frontal * (1.02 + 0.4 * e) + (phasor(i, 199) - 0.5) * 0.09) *
        (1 + 0.05 * e);
      bucketPush(sz, sx, sy, rad, Math.min(0.9, Math.max(0.045, a)));
    }

    for (let i = 0; i < nucleusN; i++) {
      const px = spinPoint(nucleusX[i], nucleusY[i], nucleusZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      const idleMul = 0.82 + flick * 0.05;
      let a =
        (0.38 + frontal * 0.58 + phasor(i, 117) * 0.32) *
        (idleMul + e * (1.1 - idleMul));
      const rad =
        (1.02 + frontal * (1.28 + 0.77 * e) + phasor(i, 223) * 0.88) * 1.04;
      bucketPush(sz, sx, sy, rad, Math.min(0.99, Math.max(0.12, a)));
    }
  }

  /** Fast fills + selective gradients — layered discs read as soft “gas” without shader cost. */
  function drawBucketsScreen() {
    ctx.globalCompositeOperation = "lighter";
    const gradAlphaMin = 0.54;
    const gradRadMin = 1.08;
    const mistLo = 0.13;
    const mistHi = 0.53;
    for (let bi = 0; bi < N_BUCK; bi++) {
      const pack = dotBuckets[bi];
      for (let j = 0; j < pack.length; j += 4) {
        const sx = pack[j];
        const sy = pack[j + 1];
        const rad = pack[j + 2];
        const alpha = pack[j + 3];
        if (alpha >= gradAlphaMin && rad >= gradRadMin) {
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * (1.62 + alpha * 0.32));
          g.addColorStop(0, `rgba(255,255,255,${alpha * 0.78})`);
          g.addColorStop(
            0.32,
            `rgba(${BLUE_HOT[0]},${BLUE_HOT[1]},${BLUE_HOT[2]},${alpha * 0.86})`
          );
          g.addColorStop(0.72, `rgba(${BLUE[0]},${BLUE[1]},${BLUE[2]},${alpha * 0.36})`);
          g.addColorStop(1, `rgba(${BLUE_DEEP[0]},${BLUE_DEEP[1]},${BLUE_DEEP[2]},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(sx, sy, rad, 0, PI2);
          ctx.fill();
        } else if (alpha >= mistLo && alpha <= mistHi) {
          const o = alpha * 0.9;
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 0.62, 0, PI2);
          ctx.fillStyle = `rgba(${BLUE_HOT[0]},${BLUE_HOT[1]},${BLUE_HOT[2]},${o * 0.38})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 0.4, 0, PI2);
          ctx.fillStyle = `rgba(${BLUE[0]},${BLUE[1]},${BLUE[2]},${o * 0.28})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 0.18, 0, PI2);
          ctx.fillStyle = `rgba(255,255,255,${o * 0.16})`;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 0.52, 0, PI2);
          ctx.fillStyle = `rgba(${BLUE_HOT[0]},${BLUE_HOT[1]},${BLUE_HOT[2]},${alpha * 0.86})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 0.14, 0, PI2);
          ctx.fillStyle = `rgba(255,255,255,${alpha * (0.26 + alpha * 0.14)})`;
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function eulerRotate(x, y, z, rx, ry, rz) {
    let c = Math.cos(rx);
    let s = Math.sin(rx);
    const y1 = y * c - z * s;
    const z1 = y * s + z * c;
    let x1 = x;
    c = Math.cos(ry);
    s = Math.sin(ry);
    const x2 = x1 * c + z1 * s;
    const y2 = y1;
    const z2 = -x1 * s + z1 * c;
    c = Math.cos(rz);
    s = Math.sin(rz);
    return [x2 * c - y2 * s, x2 * s + y2 * c, z2];
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const m = Math.min(w, h);
    const area = w * h;
    let dprCap = 2;
    if (area > 550000 && m > 480) dprCap = 2.5;
    if (area > 900000 && m > 640) dprCap = 3;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const bw = Math.max(1, Math.floor(w * dpr));
    const bh = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    logicalW = w;
    logicalH = h;
    cx = logicalW / 2;
    cy = logicalH / 2;
    projScale = Math.min(logicalW, logicalH) * 0.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    rebuildPointCloudModels();
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  function frame(now) {
    const dt = reducedMotion ? 0 : Math.min((now - lastFrameTs) / 1000, 0.05);
    lastFrameTs = now;
    if (!reducedMotion) timeSec += dt;

    const target = orbMode === "active" ? 1 : 0;
    if (reducedMotion) {
      orbEnergy = target;
    } else {
      const ramp = target > orbEnergy ? 5.1 : 3.4;
      orbEnergy += (target - orbEnergy) * Math.min(1, dt * ramp);
    }
    const e = orbEnergy;

    /** Slow drift idle; ramps smoothly while Jarvis streams a reply */
    const idleRadPerSec = 0.25;
    const activeRadPerSec = 0.44;
    const spinRate = idleRadPerSec + (activeRadPerSec - idleRadPerSec) * e;
    const spin = reducedMotion ? 0 : timeSec * spinRate;

    const wobbleAmp = 0.06 + 0.05 * e;
    const rx =
      Math.sin(timeSec * 0.17) * wobbleAmp + Math.sin(spin * 0.38) * (0.1 + 0.055 * e);
    const ry = spin * 1.08 + Math.cos(timeSec * 0.11) * 0.06;
    const rz =
      Math.cos(spin * 0.65) * 0.065 +
      spin * (0.42 + 0.24 * e) +
      Math.sin(timeSec * 0.21) * 0.085;

    ctx.clearRect(0, 0, logicalW, logicalH);

    const breathIdle = projScale * (1 + 0.018 * Math.sin(timeSec * 0.72));
    const breathActive = projScale * (1.06 + 0.045 * Math.sin(timeSec * 2.1));
    const breathOuter = breathIdle * (1 - e) + breathActive * e;
    const halo = ctx.createRadialGradient(cx - breathOuter * 0.06, cy - breathOuter * 0.1, 0, cx, cy, breathOuter * 1.32);
    halo.addColorStop(0, `rgba(${BLUE_HOT[0]},${BLUE_HOT[1]},${BLUE_HOT[2]},${0.06 + 0.05 * e})`);
    halo.addColorStop(0.35, `rgba(${BLUE[0]},${BLUE[1]},${BLUE[2]},${0.045 + 0.04 * e})`);
    halo.addColorStop(1, `rgba(${BLUE_DEEP[0]},${BLUE_DEEP[1]},${BLUE_DEEP[2]},0)`);
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, breathOuter * 1.06, 0, Math.PI * 2);
    ctx.fill();

    const veilFreq = 0.31 + 0.17 * e;
    const veilR = projScale * (1.12 + 0.022 * Math.sin(timeSec * veilFreq));
    const veil = ctx.createRadialGradient(
      cx - veilR * 0.06,
      cy - veilR * 0.09,
      0,
      cx,
      cy,
      veilR * 1.48
    );
    veil.addColorStop(0, `rgba(255,255,255,${0.024 + 0.014 * e})`);
    veil.addColorStop(0.22, `rgba(${BLUE_HOT[0]},${BLUE_HOT[1]},${BLUE_HOT[2]},${0.048 + 0.024 * e})`);
    veil.addColorStop(0.52, `rgba(${BLUE[0]},${BLUE[1]},${BLUE[2]},${0.038 + 0.02 * e})`);
    veil.addColorStop(1, `rgba(${BLUE_DEEP[0]},${BLUE_DEEP[1]},${BLUE_DEEP[2]},0)`);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = veil;
    ctx.beginPath();
    ctx.arc(cx, cy, veilR * 1.02, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";

    clearDotBuckets();
    fillPointBuckets(rx, ry, rz, e);
    drawBucketsScreen();

    const pulseIdle = 1 + 0.028 * Math.sin(timeSec * 0.96);
    const pulseActive = 1.06 + 0.035 * Math.sin(timeSec * 3.1);
    const corePulse = pulseIdle * (1 - e) + pulseActive * e;
    const cr = projScale * 0.5 * corePulse;

    ctx.globalCompositeOperation = "screen";
    const mid = ctx.createRadialGradient(cx - cr * 0.18, cy - cr * 0.14, 0, cx, cy, cr * 1.38);
    const midBright =
      (0.58 + 0.18 * Math.sin(timeSec * 0.91)) * (1 - e) + 0.98 * e;
    mid.addColorStop(0, `rgba(255, 255, 255, ${0.42 * midBright})`);
    mid.addColorStop(0.12, `rgba(${BLUE_HOT[0]}, ${BLUE_HOT[1]}, ${BLUE_HOT[2]}, ${0.52 * midBright})`);
    mid.addColorStop(0.45, `rgba(${BLUE[0]}, ${BLUE[1]}, ${BLUE[2]}, ${0.62 * midBright})`);
    mid.addColorStop(0.86, `rgba(${BLUE_DEEP[0]}, ${BLUE_DEEP[1]}, ${BLUE_DEEP[2]}, 0)`);

    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 1.05, 0, Math.PI * 2);
    ctx.fill();

    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 0.72);
    const coreHot = (0.62 + 0.16 * Math.sin(timeSec * 1.07)) * (1 - e) + e;
    inner.addColorStop(0, `rgba(255, 255, 255, ${0.98 * coreHot})`);
    inner.addColorStop(0.2, `rgba(${BLUE_HOT[0]}, ${BLUE_HOT[1]}, ${BLUE_HOT[2]}, ${0.94 * coreHot})`);
    inner.addColorStop(0.5, `rgba(${BLUE[0]}, ${BLUE[1]}, ${BLUE[2]}, ${0.92 * coreHot})`);
    inner.addColorStop(1, "rgba(0, 191, 255, 0)");

    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // Render orb once — CSS ds-orb-breathe handles all animation
  requestAnimationFrame(frame);
}

/* ═══════════ Trade logging form (shared modal: /js/log-trade-modal.js) ═══════════ */
async function openTradeForm() {
  await openLogTradeModal({
    getUserId: () =>
      currentUserId ||
      localStorage.getItem("jarvis_user") ||
      localStorage.getItem("user_id") ||
      DEFAULT_USER_ID,
    fetchTradeRowsForPrefill: async () => {
      await loadTrades();
      return Array.isArray(tradeData?.records) ? tradeData.records : [];
    },
    readApiErrorMessage,
    showToast: showTradeToast,
    onTradeSaved: async ({ outcome, pair, session, rr }) => {
      const rrStr = rr !== null && !Number.isNaN(rr) ? ` ${rr}R` : "";
      const pairStr = pair ? ` ${pair}` : "";
      const autoMsg = `Just logged a trade - ${outcome}${pairStr} ${session}${rrStr}`;
      await loadTrades();
      sendChatMessage(autoMsg);
    },
  });
}

function showTradeToast(message, isError = false) {
  document.getElementById('trade-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'trade-toast';
  toast.className = 'trade-toast' + (isError ? ' trade-toast--error' : '');
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('trade-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('trade-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

function initLogTradeBtn() {
  // Wire up the inline button inside the chat form (shown on mobile)
  const inlineBtn = document.getElementById('chat-log-trade-btn');
  if (inlineBtn) inlineBtn.addEventListener('click', openTradeForm);

  // Fixed button for desktop
  if (document.getElementById('log-trade-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'log-trade-btn';
  btn.type = 'button';
  btn.className = 'log-trade-btn';
  btn.textContent = 'LOG TRADE';
  btn.addEventListener('click', openTradeForm);
  document.body.appendChild(btn);
}

async function boot() {
  await ensureUserId();

  initChatRotatingPlaceholder();

  chatMessages = loadChatMessagesFromStorage();
  chatUiMessages = [];
  setUIMode("idle");
  renderSnapshot();
  updateSendEnabled();
  startOrb();
  initParticles();
  initVoice();
  initMuteButton();
  initMic();
  initLogTradeBtn();
  initLogoutButton();
  initChatImageLightbox();
  setOrbMode("active");
  void loadTrades()
    .then(async () => {
      updateSendEnabled();
      const flushed = await maybeFlushPendingJournalAsk();
      if (!flushed) void showGreeting();
    })
    .finally(() => setOrbMode("idle"));
  els.chatInput?.focus();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || chatSending) return;
  if (tradeData?.loadError || !tradesLoaded) {
    void loadTrades();
  }
});

window.addEventListener("pageshow", (ev) => {
  if (ev.persisted && !chatSending) void loadTrades();
});

function keepAlive() {
  fetch("/api/ping", { cache: "no-store" }).catch(() => {});
}
keepAlive();
setInterval(keepAlive, 4 * 60 * 1000);

boot();
