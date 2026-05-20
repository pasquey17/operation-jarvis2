/**
 * Home dashboard calibration progress (< 50 trades).
 * Fetches GET /api/user/jarvis-intro on load.
 */
import { apiFetch } from "./jarvis-auth.js";

const BANNER_DISMISSED_KEY = "jarvis_calibrated_30_banner_dismissed";

/**
 * @param {number} tradeCount
 * @returns {{ target: number, helper: string, showCalibrated: boolean } | null}
 */
function calibrationTier(tradeCount) {
  const n = Math.max(0, Math.floor(Number(tradeCount) || 0));
  if (n >= 50) return null;
  if (n < 15) {
    return {
      target: 15,
      helper: "Jarvis starts watching your patterns at 15 trades",
      showCalibrated: false,
    };
  }
  if (n < 30) {
    return {
      target: 30,
      helper: "Jarvis unlocks full pattern analysis at 30 trades",
      showCalibrated: false,
    };
  }
  return {
    target: 50,
    helper: "Full calibration unlocks at 50 trades",
    showCalibrated: true,
  };
}

function shouldShowCalibratedBanner(tradeCount) {
  if (tradeCount !== 30) return false;
  try {
    return localStorage.getItem(BANNER_DISMISSED_KEY) !== "1";
  } catch {
    return true;
  }
}

function dismissCalibratedBanner() {
  try {
    localStorage.setItem(BANNER_DISMISSED_KEY, "1");
  } catch {
    /* private mode */
  }
}

/**
 * @param {HTMLElement} root
 * @param {number} tradeCount
 */
function renderCalibrationBar(root, tradeCount) {
  const tier = calibrationTier(tradeCount);
  if (!tier) {
    root.hidden = true;
    root.innerHTML = "";
    return;
  }

  const n = Math.max(0, Math.floor(Number(tradeCount) || 0));
  const pct = Math.min(100, Math.round((n / tier.target) * 100));
  const showBanner = shouldShowCalibratedBanner(n);

  const bannerHtml = showBanner
    ? `<button type="button" class="jarvis-calibration__banner" data-calibration-banner aria-label="Dismiss calibration notice">
        <span class="jarvis-calibration__banner-text">🎉 Jarvis is calibrated! Deep Think is now available.</span>
        <span class="jarvis-calibration__banner-dismiss" aria-hidden="true">×</span>
      </button>`
    : "";

  const calibratedHtml = tier.showCalibrated
    ? `<span class="jarvis-calibration__calibrated">Jarvis calibrated ✓</span>`
    : "";

  root.hidden = false;
  root.innerHTML =
    bannerHtml +
    `<div class="jarvis-calibration__panel">
      <div class="jarvis-calibration__head">
        <span class="jarvis-calibration__label">JARVIS CALIBRATION</span>
        ${calibratedHtml}
      </div>
      <div class="jarvis-calibration__row">
        <div class="jarvis-calibration__track" role="progressbar" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="${tier.target}" aria-label="Calibration progress">
          <div class="jarvis-calibration__fill" style="width:${pct}%"></div>
        </div>
        <span class="jarvis-calibration__count">${n} / ${tier.target} trades</span>
      </div>
      <p class="jarvis-calibration__helper">${tier.helper}</p>
    </div>`;

  const bannerBtn = root.querySelector("[data-calibration-banner]");
  if (bannerBtn) {
    bannerBtn.addEventListener("click", () => {
      dismissCalibratedBanner();
      bannerBtn.remove();
    });
  }
}

/**
 * Mount and fetch jarvis-intro for the home dashboard calibration UI.
 * @param {string} [mountId]
 */
export async function initJarvisCalibrationBar(mountId = "jarvis-calibration") {
  const root = document.getElementById(mountId);
  if (!root) return;

  root.hidden = true;

  try {
    const res = await apiFetch("/api/user/jarvis-intro", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;

    const tradeCount =
      typeof data.trade_count === "number"
        ? data.trade_count
        : Number(data.trade_count) || 0;

    renderCalibrationBar(root, tradeCount);
  } catch {
    /* silent — bar stays hidden */
  }
}
