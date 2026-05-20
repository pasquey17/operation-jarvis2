/**
 * First-time 4-step tooltip walkthrough for the classic home dashboard.
 */
import { getAuthUserId } from "./jarvis-auth.js";

const STORAGE_KEY = "jarvis_guide_dismissed";

const STEPS = [
  {
    id: "journal",
    resolveTarget: () =>
      document.getElementById("nav-journal") ||
      document.querySelector('.jv-nav__dropdown a[href="/journal.html"]'),
    title: "Your trading journal",
    body: "Log every trade here. The more detail you add, the smarter Jarvis gets.",
    button: "Next →",
  },
  {
    id: "chat",
    resolveTarget: () =>
      document.querySelector(".comm-dock") ||
      document.getElementById("chat-form") ||
      document.getElementById("chat-input"),
    title: "Talk to Jarvis",
    body: "Ask Jarvis anything about your trading. It knows your full history and learns from every conversation.",
    button: "Next →",
  },
  {
    id: "analytics",
    resolveTarget: () =>
      document.getElementById("nav-analytics") ||
      document.querySelector('.jv-nav__dropdown a[href="/analytics.html"]'),
    title: "Your analytics",
    body: "Your performance broken down by session, model, and time. Updated every time you log a trade.",
    button: "Next →",
  },
  {
    id: "deep-think",
    resolveTarget: () =>
      document.getElementById("deep-think") ||
      document.querySelector("[data-guide-deep-think]") ||
      document.querySelector(".deep-think") ||
      null,
    title: "Deep Think",
    body: "Once a week, Jarvis runs a deep analysis of your patterns and tells you exactly what to work on. Unlocks at 30 trades.",
    button: "Got it →",
    centerFallback: true,
  },
];

function isDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return true;
  }
}

function dismissGuide() {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    /* private mode */
  }
}

function createGuideRoot() {
  const root = document.createElement("div");
  root.className = "jarvis-guide";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Jarvis product guide");
  root.innerHTML = `
    <button type="button" class="jarvis-guide__skip">Skip guide</button>
    <div class="jarvis-guide__veil" aria-hidden="true"></div>
    <div class="jarvis-guide__spotlight" aria-hidden="true"></div>
    <div class="jarvis-guide__tooltip">
      <div class="jarvis-guide__tooltip-inner">
        <h2 class="jarvis-guide__title"></h2>
        <p class="jarvis-guide__body"></p>
        <button type="button" class="jarvis-guide__next"></button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

/**
 * @param {HTMLElement} root
 * @param {number} stepIndex
 */
function renderStep(root, stepIndex) {
  const step = STEPS[stepIndex];
  const veil = root.querySelector(".jarvis-guide__veil");
  const spotlight = root.querySelector(".jarvis-guide__spotlight");
  const tooltip = root.querySelector(".jarvis-guide__tooltip");
  const titleEl = root.querySelector(".jarvis-guide__title");
  const bodyEl = root.querySelector(".jarvis-guide__body");
  const nextBtn = root.querySelector(".jarvis-guide__next");

  root.querySelectorAll(".jarvis-guide-target").forEach((el) => {
    el.classList.remove("jarvis-guide-target");
  });

  titleEl.textContent = step.title;
  bodyEl.textContent = step.body;
  nextBtn.textContent = step.button;

  const target = step.resolveTarget();
  const useCenter = !target && step.centerFallback;

  if (useCenter || !target) {
    veil.hidden = false;
    spotlight.hidden = true;
    tooltip.classList.add("jarvis-guide__tooltip--center");
    tooltip.style.left = "";
    tooltip.style.top = "";
    tooltip.style.visibility = "visible";
    return;
  }

  veil.hidden = true;
  tooltip.classList.remove("jarvis-guide__tooltip--center");
  spotlight.hidden = false;
  target.classList.add("jarvis-guide-target");

  try {
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  } catch {
    /* ignore */
  }

  const place = () => {
    const rect = target.getBoundingClientRect();
    const pad = 8;
    spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    positionTooltip(tooltip, rect);
  };

  place();
  root._guidePlace = place;
}

/**
 * @param {HTMLElement} tooltip
 * @param {DOMRect} targetRect
 */
function positionTooltip(tooltip, targetRect) {
  const margin = 14;
  tooltip.style.visibility = "hidden";
  tooltip.style.transform = "none";
  tooltip.style.left = "0px";
  tooltip.style.top = "0px";

  const tipW = tooltip.offsetWidth;
  const tipH = tooltip.offsetHeight;

  let left = targetRect.right + margin;
  let top = targetRect.top + Math.max(0, (targetRect.height - tipH) / 2);

  if (left + tipW > window.innerWidth - 16) {
    left = targetRect.left - margin - tipW;
  }
  if (left < 16) {
    left = Math.max(16, (window.innerWidth - tipW) / 2);
    top = targetRect.bottom + margin;
  }
  if (top + tipH > window.innerHeight - 16) {
    top = Math.max(16, targetRect.top - margin - tipH);
  }
  if (top < 72) top = 72;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.visibility = "visible";
}

function runGuide() {
  const root = createGuideRoot();
  let stepIndex = 0;
  let fading = false;

  const fadeSwap = (nextIndex) => {
    if (fading) return;
    fading = true;
    root.classList.add("jarvis-guide--transition");
    window.setTimeout(() => {
      renderStep(root, nextIndex);
      stepIndex = nextIndex;
      root.classList.remove("jarvis-guide--transition");
      fading = false;
    }, 180);
  };

  const teardown = () => {
    dismissGuide();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeydown);
    root.querySelectorAll(".jarvis-guide-target").forEach((el) => {
      el.classList.remove("jarvis-guide-target");
    });
    root.remove();
  };

  const onResize = () => {
    if (root._guidePlace) root._guidePlace();
    else renderStep(root, stepIndex);
  };

  const onKeydown = (e) => {
    if (e.key === "Escape") teardown();
  };

  root.querySelector(".jarvis-guide__skip").addEventListener("click", teardown);
  root.querySelector(".jarvis-guide__next").addEventListener("click", () => {
    if (stepIndex >= STEPS.length - 1) {
      teardown();
      return;
    }
    fadeSwap(stepIndex + 1);
  });

  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeydown);

  requestAnimationFrame(() => {
    root.classList.add("jarvis-guide--visible");
    renderStep(root, 0);
  });
}

/** Start guide when logged in and not previously dismissed. */
export async function initJarvisGuide() {
  if (isDismissed()) return;

  const userId = await getAuthUserId();
  if (!userId) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => runGuide());
  });
}
