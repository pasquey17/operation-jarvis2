const API_CHAT = "/api/chat";
const API_TRADES = "/api/trades";
const DEFAULT_USER_ID = "aidenpasque11@gmail.com";
const USER_MUM_ID = "spasque70@gmail.com";
const STORAGE_KEY_CHAT = "operationJarvis.chat.v1";
const CHAT_RECENT_TRADES = 15;
const MAX_CHAT_MESSAGES_API = 5;
const MAX_CHAT_MESSAGE_CHARS = 1800;
const MAX_CHAT_MESSAGES_STORED = 120;

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
    row.textContent = streamLast && isLast ? "" : m.content;
    frag.appendChild(row);
  }
  els.chatHistory.appendChild(frag);

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
    if (els.snapInsight) els.snapInsight.textContent = "Loading your system…";
    return;
  }

  if (els.snapTotal) els.snapTotal.textContent = String(s.total ?? "—");
  if (els.snapWinrate)
    els.snapWinrate.textContent =
      s.winRate == null ? "—" : `${Number(s.winRate).toFixed(1)}%`;
  if (els.snapAvgRR)
    els.snapAvgRR.textContent =
      s.avgRR == null ? "—" : Number(s.avgRR).toFixed(2);
  if (els.snapExpectancy)
    els.snapExpectancy.textContent =
      s.expectancy == null ? "—" : `${Number(s.expectancy).toFixed(2)}R`;
  if (els.snapInsight) {
    let line = s.bestSession ? `Most active session: ${s.bestSession}` : "—";
    if (tradeData?.warning) {
      line = `${line}${line && line !== "—" ? " · " : ""}${tradeData.warning}`;
    }
    els.snapInsight.textContent = line;
  }
}

function getRecentTradesForChat(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  return records.slice(-CHAT_RECENT_TRADES);
}

/* ═══════════ Greeting ═══════════ */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Systems online. Good morning. Ready when you are.";
  if (h < 17) return "Systems online. Good afternoon. Standing by.";
  return "Systems online. Good evening. Let's review your session.";
}

async function showGreeting() {
  const text = getGreeting();
  chatUiMessages.push({ role: "assistant", content: text });
  setUIMode("chat");
  renderChatHistory({ streamLast: true });
  const lastEl = els.chatHistory?.lastElementChild;
  if (lastEl) {
    // speakText(text);
    await streamWords(text, lastEl);
  }
}

/* ═══════════ Particle system ═══════════ */
let particleMode = "idle"; // 'idle' | 'active' | 'scatter'
const PARTICLE_COUNT = 420;
const particles = [];

class Particle {
  constructor() {
    this.x = Math.random() * window.innerWidth;
    this.y = Math.random() * window.innerHeight;
    this._resetKinematics();
  }

  _resetKinematics() {
    const speed = Math.random() * 0.3 + 0.04;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.size = Math.random() * 0.7 + 0.2;
    this.baseAlpha = Math.random() * 0.45 + 0.08;
    this.alpha = this.baseAlpha;
    this.twinkle = Math.random() * Math.PI * 2;
    const r = Math.random();
    if (r < 0.65) {
      this.cr = 0; this.cg = 191; this.cb = 255; // electric blue
    } else if (r < 0.93) {
      this.cr = 192; this.cg = 192; this.cb = 192; // silver
    } else {
      this.cr = 255; this.cg = 255; this.cb = 255; // white flash
      this.size = Math.random() * 1.0 + 0.2;
      this.baseAlpha = Math.random() * 0.6 + 0.2;
    }
  }

  update(orbCenter) {
    this.twinkle += 0.018;

    if (particleMode === "active") {
      this.vx *= 0.999;
      this.vy *= 0.999;
      this.vx += (Math.random() - 0.5) * 0.008;
      this.vy += (Math.random() - 0.5) * 0.008;
      this.alpha = Math.min(1, this.baseAlpha * 2.5 + 0.1);
    } else if (particleMode === "scatter") {
      const dx = this.x - orbCenter.x;
      const dy = this.y - orbCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      this.vx += (dx / dist) * 0.055;
      this.vy += (dy / dist) * 0.055;
      this.vx *= 0.972;
      this.vy *= 0.972;
      this.alpha = this.baseAlpha * (0.8 + 0.2 * Math.abs(Math.sin(this.twinkle * 3)));
    } else {
      this.vx *= 0.998;
      this.vy *= 0.998;
      this.vx += (Math.random() - 0.5) * 0.004;
      this.vy += (Math.random() - 0.5) * 0.004;
      this.alpha = this.baseAlpha * (0.72 + 0.28 * Math.sin(this.twinkle));
    }

    this.x += this.vx;
    this.y += this.vy;

    const W = window.innerWidth;
    const H = window.innerHeight;
    if (this.x < -20) this.x = W + 20;
    if (this.x > W + 20) this.x = -20;
    if (this.y < -20) this.y = H + 20;
    if (this.y > H + 20) this.y = -20;
  }

  draw(ctx) {
    const a = Math.max(0, Math.min(1, this.alpha));
    if (particleMode === "active" || this.size > 1.3) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 3.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.cr},${this.cg},${this.cb},${a * 0.1})`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.cr},${this.cg},${this.cb},${a})`;
    ctx.fill();
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
  }
  resize();
  window.addEventListener("resize", resize);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }

  function loop() {
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
    const orb = getOrbCenter();
    for (const p of particles) {
      p.update(orb);
      p.draw(pCtx);
    }
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
  const maxAttempts = 3;
  const delayMs = 500;
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
    if (lastEl) await streamWords(reply, lastEl);
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

  const BLUE = [0, 191, 255];
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

  let hullN = 0;
  let interiorN = 0;
  let nucleusN = 0;
  let shellN = 0;
  let strayN = 0;
  let hullX,
    hullY,
    hullZ,
    interiorX,
    interiorY,
    interiorZ,
    nucleusX,
    nucleusY,
    nucleusZ,
    shellX,
    shellY,
    shellZ,
    strayX,
    strayY,
    strayZ;

  function phasor(i, salt) {
    const t = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453123;
    return t - Math.floor(t);
  }

  let cloudCacheKey = "";

  const N_BUCK = 24;
  const dotBuckets = Array.from({ length: N_BUCK }, () => []);

  function computeCloudBudget() {
    const m = Math.min(logicalW, logicalH);
    const area = logicalW * logicalH;
    if (area < 150000 || m < 300) {
      return { hull: 260, shell: 420, interior: 190, nucleus: 110, stray: 45 };
    }
    if (area < 320000 || m < 420) {
      return { hull: 400, shell: 720, interior: 340, nucleus: 170, stray: 80 };
    }
    if (area < 700000) {
      return { hull: 560, shell: 1080, interior: 500, nucleus: 240, stray: 110 };
    }
    return { hull: 720, shell: 1480, interior: 680, nucleus: 300, stray: 150 };
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
    const key = `${b.hull}|${b.shell}|${b.interior}|${b.nucleus}|${b.stray}`;
    if (key === cloudCacheKey && hullX?.length === b.hull) return;
    cloudCacheKey = key;

    hullN = b.hull;
    interiorN = b.interior;
    nucleusN = b.nucleus;
    shellN = b.shell;
    strayN = b.stray;

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
      const rad = 0.14 + phasor(i, 8) * 0.82;
      const rr = Math.sqrt(Math.max(0, 1 - u * u)) * rad;
      interiorX[i] = rr * Math.cos(th);
      interiorY[i] = rr * Math.sin(th);
      interiorZ[i] = u * rad;
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

  function fillPointBuckets(rx, ry, rz, active) {
    const tw = active ? 1.38 : 1;
    const flick = reducedMotion ? 0 : Math.sin(timeSec * (active ? 2 : 0.68));

    function spinPoint(x, y, z) {
      return eulerRotate(x, y, z, rx, ry, rz);
    }

    /** Distant sparkles — drawn first in buckets (farther Z typically earlier draws ok) */
    for (let i = 0; i < strayN; i++) {
      const px = spinPoint(strayX[i], strayY[i], strayZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a = (0.03 + frontal * 0.14 + phasor(i, 501) * 0.06) * tw * (active ? 1.35 : 1);
      const rad = (0.28 + frontal * 0.55 + phasor(i, 602) * 0.35) * (active ? 1.08 : 1);
      bucketPush(sz, sx, sy, rad, Math.min(0.38, Math.max(0.02, a)));
    }

    for (let i = 0; i < interiorN; i++) {
      const px = spinPoint(interiorX[i], interiorY[i], interiorZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a =
        (0.035 + frontal * 0.22 + Math.sqrt(phasor(i, 91)) * 0.07) * tw * (active ? 1.22 : 0.88);
      const rad =
        (0.28 + frontal * 0.68 + phasor(i, 71) * 0.38) * (active ? 1.04 : 0.96);
      bucketPush(sz, sx, sy, rad, Math.min(0.58, Math.max(0.02, a)));
    }

    for (let i = 0; i < shellN; i++) {
      const px = spinPoint(shellX[i], shellY[i], shellZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      const dist = Math.hypot(shellX[i], shellY[i], shellZ[i]) || 0.01;
      const shellFac = Math.max(0, Math.min(1, (dist - 0.32) / 0.68));
      let a =
        (0.07 + frontal * 0.42 * (0.35 + shellFac * 0.65) + (phasor(i, 3) - 0.5) * 0.04) * tw;
      a += frontal * (active ? 0.05 + flick * 0.018 : flick * 0.01);
      const rad =
        (0.32 + frontal * (0.85 + shellFac * 0.55) + phasor(i, 99) * 0.12) * (active ? 1.05 : 1);
      bucketPush(sz, sx, sy, rad, Math.min(0.88, Math.max(0.04, a)));
    }

    for (let i = 0; i < hullN; i++) {
      const px = spinPoint(hullX[i], hullY[i], hullZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a = (0.12 + frontal * 0.42 + (phasor(i, 11) - 0.5) * 0.04) * tw;
      a += frontal * (active ? 0.07 + flick * 0.022 : flick * 0.014);
      const rad =
        (0.38 + frontal * (active ? 1.38 : 0.96) + (phasor(i, 199) - 0.5) * 0.08) *
        (active ? 1.05 : 1);
      bucketPush(sz, sx, sy, rad, Math.min(0.92, Math.max(0.05, a)));
    }

    for (let i = 0; i < nucleusN; i++) {
      const px = spinPoint(nucleusX[i], nucleusY[i], nucleusZ[i]);
      const sz = px[2];
      const frontal = Math.max(0, Math.min(1, (sz + 1) * 0.5));
      const sx = cx + px[0] * projScale;
      const sy = cy - px[1] * projScale;
      let a =
        (0.38 + frontal * 0.58 + phasor(i, 117) * 0.32) * (active ? 1.1 : 0.82 + flick * 0.05);
      const rad =
        (1.02 + frontal * (active ? 2.05 : 1.28) + phasor(i, 223) * 0.88) * 1.04;
      bucketPush(sz, sx, sy, rad, Math.min(0.99, Math.max(0.12, a)));
    }
  }

  /** Fast fills for mist; soft gradients only on bright nucleus-grade dots (keeps 60fps). */
  function drawBucketsScreen() {
    ctx.globalCompositeOperation = "lighter";
    const gradAlphaMin = 0.56;
    const gradRadMin = 1.05;
    for (let bi = 0; bi < N_BUCK; bi++) {
      const pack = dotBuckets[bi];
      for (let j = 0; j < pack.length; j += 4) {
        const sx = pack[j];
        const sy = pack[j + 1];
        const rad = pack[j + 2];
        const alpha = pack[j + 3];
        if (alpha >= gradAlphaMin && rad >= gradRadMin) {
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * (1.65 + alpha * 0.35));
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
        } else {
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 0.52, 0, PI2);
          ctx.fillStyle = `rgba(${BLUE_HOT[0]},${BLUE_HOT[1]},${BLUE_HOT[2]},${alpha * 0.88})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy, rad * 0.14, 0, PI2);
          ctx.fillStyle = `rgba(255,255,255,${alpha * (0.28 + alpha * 0.14)})`;
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

    const active = orbMode === "active";

    /** Slow drift idle; noticeably more energy when Jarvis replies, still subdued */
    const idleRadPerSec = 0.25;
    const activeRadPerSec = 0.52;
    const spin = reducedMotion ? 0 : timeSec * (active ? activeRadPerSec : idleRadPerSec);

    const wobbleAmp = active ? 0.11 : 0.06;
    const rx =
      Math.sin(timeSec * 0.19) * wobbleAmp + Math.sin(spin * 0.42) * (active ? 0.16 : 0.1);
    const ry = spin * 1.12 + Math.cos(timeSec * 0.11) * 0.06;
    const rz =
      Math.cos(spin * 0.71) * 0.07 + spin * (active ? 0.68 : 0.42) + Math.sin(timeSec * 0.23) * 0.09;

    ctx.clearRect(0, 0, logicalW, logicalH);

    const breathOuter =
      active
        ? projScale * (1.06 + 0.045 * Math.sin(timeSec * 2.1))
        : projScale * (1 + 0.018 * Math.sin(timeSec * 0.72));
    const halo = ctx.createRadialGradient(cx - breathOuter * 0.06, cy - breathOuter * 0.1, 0, cx, cy, breathOuter * 1.32);
    halo.addColorStop(0, `rgba(${BLUE_HOT[0]},${BLUE_HOT[1]},${BLUE_HOT[2]},${active ? 0.11 : 0.06})`);
    halo.addColorStop(0.35, `rgba(${BLUE[0]},${BLUE[1]},${BLUE[2]},${active ? 0.085 : 0.045})`);
    halo.addColorStop(1, `rgba(${BLUE_DEEP[0]},${BLUE_DEEP[1]},${BLUE_DEEP[2]},0)`);
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, breathOuter * 1.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";

    clearDotBuckets();
    fillPointBuckets(rx, ry, rz, active);
    drawBucketsScreen();

    const corePulse = active ? 1.06 + 0.035 * Math.sin(timeSec * 3.1) : 1 + 0.028 * Math.sin(timeSec * 0.96);
    const cr = projScale * 0.5 * corePulse;

    ctx.globalCompositeOperation = "screen";
    const mid = ctx.createRadialGradient(cx - cr * 0.18, cy - cr * 0.14, 0, cx, cy, cr * 1.38);
    const midBright = active ? 0.98 : 0.58 + 0.18 * Math.sin(timeSec * 0.91);
    mid.addColorStop(0, `rgba(255, 255, 255, ${0.42 * midBright})`);
    mid.addColorStop(0.12, `rgba(${BLUE_HOT[0]}, ${BLUE_HOT[1]}, ${BLUE_HOT[2]}, ${0.52 * midBright})`);
    mid.addColorStop(0.45, `rgba(${BLUE[0]}, ${BLUE[1]}, ${BLUE[2]}, ${0.62 * midBright})`);
    mid.addColorStop(0.86, `rgba(${BLUE_DEEP[0]}, ${BLUE_DEEP[1]}, ${BLUE_DEEP[2]}, 0)`);

    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 1.05, 0, Math.PI * 2);
    ctx.fill();

    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 0.72);
    const coreHot = active ? 1 : 0.62 + 0.16 * Math.sin(timeSec * 1.07);
    inner.addColorStop(0, `rgba(255, 255, 255, ${0.98 * coreHot})`);
    inner.addColorStop(0.2, `rgba(${BLUE_HOT[0]}, ${BLUE_HOT[1]}, ${BLUE_HOT[2]}, ${0.94 * coreHot})`);
    inner.addColorStop(0.5, `rgba(${BLUE[0]}, ${BLUE[1]}, ${BLUE[2]}, ${0.92 * coreHot})`);
    inner.addColorStop(1, "rgba(0, 191, 255, 0)");

    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(cx, cy, cr * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

/* ═══════════ Trade logging form ═══════════ */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CORE_FIELD_NAMES = new Set(['date', 'session', 'outcome', 'rr', 'pair', 'account']);
let tradeFormOpen = false;

function renderCustomField(f) {
  const id = `tf-${f.field_name.toLowerCase().replace(/\s+/g, '-')}`;
  const label = escHtml(f.field_name);
  const req = f.is_required ? 'required' : '';
  const name = escHtml(f.field_name);

  if (f.field_type === 'dropdown' || f.field_type === 'multiselect') {
    let options = [];
    try { options = JSON.parse(f.field_options || '[]'); } catch {}
    const multiple = f.field_type === 'multiselect' ? 'multiple' : '';
    const opts = options.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');
    return `<div class="trade-field trade-field--full">
        <label class="trade-label" for="${id}">${label}</label>
        <select id="${id}" name="${name}" class="trade-input" data-custom="1" ${multiple} ${req}>
          <option value="">— select —</option>${opts}
        </select>
      </div>`;
  }

  if (f.field_type === 'number') {
    return `<div class="trade-field">
        <label class="trade-label" for="${id}">${label}</label>
        <input id="${id}" type="number" name="${name}" class="trade-input" data-custom="1" step="0.01" ${req}>
      </div>`;
  }

  return `<div class="trade-field trade-field--full">
      <label class="trade-label" for="${id}">${label}</label>
      <textarea id="${id}" name="${name}" class="trade-input" data-custom="1" rows="3" ${req}></textarea>
    </div>`;
}

async function openTradeForm() {
  if (tradeFormOpen) return;
  tradeFormOpen = true;

  const userId =
    currentUserId ||
    localStorage.getItem("jarvis_user") ||
    localStorage.getItem("user_id") ||
    DEFAULT_USER_ID;
  let customFields = [];
  try {
    const r = await fetch(`/api/journal-fields?user_id=${encodeURIComponent(userId)}`, { cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    const all = Array.isArray(data.fields) ? data.fields : [];
    customFields = all.filter(f => !CORE_FIELD_NAMES.has(f.field_name.toLowerCase()));
  } catch {}

  const today = new Date().toISOString().slice(0, 10);
  const customHtml = customFields.map(renderCustomField).join('');

  const overlay = document.createElement('div');
  overlay.className = 'trade-form-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  overlay.innerHTML = `
    <div class="trade-form-panel" id="trade-form-panel">
      <div class="trade-form-header">
        <span class="trade-form-title">LOG TRADE</span>
        <button type="button" class="trade-form-close" aria-label="Close">&#x2715;</button>
      </div>
      <div class="trade-form-body">
        <form id="trade-log-form" autocomplete="off" novalidate>
          <div class="trade-form-grid">
            <div class="trade-field">
              <label class="trade-label" for="tf-date">Date</label>
              <input id="tf-date" type="date" name="date" class="trade-input" value="${escHtml(today)}" required>
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-pair">Pair</label>
              <input id="tf-pair" type="text" name="pair" class="trade-input" placeholder="e.g. XAUUSD">
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-session">Session</label>
              <select id="tf-session" name="session" class="trade-input" required>
                <option value="">— select —</option>
                <option value="Asia">Asia</option>
                <option value="London">London</option>
                <option value="New York">New York</option>
                <option value="London/New York">London/New York</option>
              </select>
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-outcome">Outcome</label>
              <select id="tf-outcome" name="outcome" class="trade-input" required>
                <option value="">— select —</option>
                <option value="Win">Win</option>
                <option value="Loss">Loss</option>
                <option value="BE">BE</option>
              </select>
            </div>
            <div class="trade-field" id="tf-rr-field">
              <label class="trade-label" for="tf-rr">RR</label>
              <input id="tf-rr" type="number" name="rr" class="trade-input" step="0.01" min="0" placeholder="e.g. 2.5">
            </div>
            <div class="trade-field">
              <label class="trade-label" for="tf-account">Account</label>
              <input id="tf-account" type="text" name="account" class="trade-input" placeholder="e.g. Main">
            </div>
            ${customHtml}
          </div>
          <div class="trade-form-actions">
            <button type="submit" class="trade-submit-btn">SAVE TRADE</button>
          </div>
        </form>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('trade-form-overlay--visible');
    document.getElementById('trade-form-panel')?.classList.add('trade-form-panel--visible');
  });

  function closeForm() {
    overlay.classList.remove('trade-form-overlay--visible');
    document.getElementById('trade-form-panel')?.classList.remove('trade-form-panel--visible');
    overlay.addEventListener('transitionend', () => {
      overlay.remove();
      tradeFormOpen = false;
    }, { once: true });
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeForm(); });
  overlay.querySelector('.trade-form-close').addEventListener('click', closeForm);

  const outcomeSelect = document.getElementById('tf-outcome');
  const rrField = document.getElementById('tf-rr-field');
  outcomeSelect?.addEventListener('change', () => {
    if (rrField) rrField.style.display = outcomeSelect.value === 'BE' ? 'none' : '';
  });

  const form = document.getElementById('trade-log-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await submitTradeForm(form, customFields, closeForm);
  });

  document.getElementById('tf-date')?.focus();
}

async function submitTradeForm(form, customFields, closeForm) {
  const fd = new FormData(form);
  const userId =
    currentUserId ||
    localStorage.getItem("jarvis_user") ||
    localStorage.getItem("user_id") ||
    DEFAULT_USER_ID;

  const dateVal = fd.get('date') || '';
  const pair = (fd.get('pair') || '').trim();
  const session = fd.get('session') || '';
  const outcome = fd.get('outcome') || '';
  const rrRaw = fd.get('rr');
  const rr = rrRaw !== '' && rrRaw !== null ? Number(rrRaw) : null;
  const account = (fd.get('account') || '').trim();

  if (!dateVal || !session || !outcome) {
    showTradeToast('Date, Session and Outcome are required.', true);
    return;
  }

  const custom_data = {};
  for (const f of customFields) {
    const val = fd.get(f.field_name);
    if (val !== null && String(val).trim() !== '') custom_data[f.field_name] = val;
  }

  const submitBtn = form.querySelector('.trade-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

  try {
    const res = await fetch('/api/log-trade', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        traded_at: dateVal + 'T00:00:00.000Z',
        pair: pair || null,
        outcome,
        rr: rr !== null && !isNaN(rr) ? rr : null,
        session,
        account: account || null,
        custom_data,
      }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(readApiErrorMessage(d) || `Save failed (${res.status})`);
    }

    closeForm();
    showTradeToast('Trade logged.');

    const rrStr = rr !== null && !isNaN(rr) ? ` ${rr}R` : '';
    const pairStr = pair ? ` ${pair}` : '';
    const autoMsg = `Just logged a trade - ${outcome}${pairStr} ${session}${rrStr}`;
    void loadTrades();
    sendChatMessage(autoMsg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Save failed.';
    showTradeToast(msg, true);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'SAVE TRADE'; }
  }
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
  setOrbMode("active");
  void loadTrades()
    .then(() => {
      updateSendEnabled();
      showGreeting();
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

boot();
