/**
 * Position size pip value resolver (Myfxbook-style, USD account).
 * Lot Size = Risk$ / (Stop pips × Pip value per standard lot)
 */

const RATES_URL = "https://api.exchangerate-api.com/v4/latest/USD";
const RATES_TTL_MS = 60 * 60 * 1000;

const INDEX_SYMBOLS = new Set([
  "NAS100",
  "US100",
  "USTEC",
  "NAS",
  "US30",
  "DJ30",
  "US500",
  "SPX500",
  "SP500",
  "US2000",
  "DAX",
  "GER40",
  "DE40",
  "FTSE",
  "UK100",
]);

let ratesCache = null;
let ratesCacheAt = 0;
let ratesPromise = null;

export function normalizePairSymbol(sym) {
  return String(sym || "")
    .replace(/[\s/_-]/g, "")
    .toUpperCase();
}

function parseForexLegs(symbol) {
  const s = normalizePairSymbol(symbol);
  if (s.length === 6) {
    return { base: s.slice(0, 3), quote: s.slice(3, 6) };
  }
  if (s.length === 7 && (s.startsWith("XAU") || s.startsWith("XAG"))) {
    return { base: s.slice(0, 3), quote: s.slice(3) };
  }
  return { base: s.slice(0, 3), quote: s.slice(-3) };
}

function detectCategory(symbol) {
  const s = normalizePairSymbol(symbol);
  if (s === "XAUUSD" || s === "GOLD" || s.startsWith("XAU")) return "gold";
  if (s === "XAGUSD" || s === "SILVER" || s.startsWith("XAG")) return "silver";
  if (/^BTC|^ETH/.test(s) && s.endsWith("USD")) return "crypto";
  if (INDEX_SYMBOLS.has(s) || /^US\d/.test(s)) return "index";
  return "forex";
}

/** @returns {Promise<Record<string, number>>} quote currency units per 1 USD */
export async function fetchUsdRates() {
  if (ratesCache && Date.now() - ratesCacheAt < RATES_TTL_MS) {
    return ratesCache;
  }
  if (ratesPromise) return ratesPromise;

  ratesPromise = fetch(RATES_URL, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("Exchange rate request failed");
      return r.json();
    })
    .then((data) => {
      const rates = data && typeof data.rates === "object" ? data.rates : {};
      ratesCache = rates;
      ratesCacheAt = Date.now();
      ratesPromise = null;
      return rates;
    })
    .catch((err) => {
      ratesPromise = null;
      throw err;
    });

  return ratesPromise;
}

function rateForQuote(rates, quote) {
  if (!rates || quote === "USD") return 1;
  const r = rates[quote];
  if (typeof r !== "number" || !Number.isFinite(r) || r <= 0) return null;
  return r;
}

/**
 * Pip value per standard lot in USD.
 * @param {string} symbol
 * @param {Record<string, number>|null} [rates]
 */
export function pipValuePerLotSync(symbol, rates) {
  const s = normalizePairSymbol(symbol);
  const cat = detectCategory(s);

  if (cat === "gold") {
    return { pipSize: 0.01, pipUsdPerLot: 1, category: cat, source: "metal" };
  }
  if (cat === "silver") {
    return { pipSize: 0.001, pipUsdPerLot: 5, category: cat, source: "metal" };
  }
  if (cat === "crypto") {
    return { pipSize: 1, pipUsdPerLot: 1, category: cat, source: "crypto" };
  }
  if (cat === "index") {
    return { pipSize: 1, pipUsdPerLot: 1, category: cat, source: "index" };
  }

  const { base, quote } = parseForexLegs(s);
  const quoteCcys = ["USD", "JPY", "EUR", "GBP", "AUD", "NZD", "CAD", "CHF"];

  if (!quoteCcys.includes(quote) || !quoteCcys.includes(base)) {
    return { pipSize: 0.0001, pipUsdPerLot: 10, category: "forex", source: "fallback" };
  }

  if (quote === "USD") {
    return { pipSize: 0.0001, pipUsdPerLot: 10, category: "forex", source: "usd-quote" };
  }

  if (base === "USD") {
    const pipSize = quote === "JPY" ? 0.01 : 0.0001;
    const qRate = rateForQuote(rates, quote);
    if (!qRate) {
      return { pipSize, pipUsdPerLot: null, category: "forex", source: "usd-base", needsRates: true };
    }
    const pipUsdPerLot = quote === "JPY" ? 1000 / qRate : 10 / qRate;
    return { pipSize, pipUsdPerLot, category: "forex", source: "usd-base" };
  }

  const pipSize = quote === "JPY" ? 0.01 : 0.0001;
  const qRate = rateForQuote(rates, quote);
  if (!qRate) {
    return { pipSize, pipUsdPerLot: null, category: "forex", source: "cross", needsRates: true };
  }
  const pipUsdPerLot = (pipSize / qRate) * 100000;
  return { pipSize, pipUsdPerLot, category: "forex", source: "cross" };
}

/**
 * @param {string} symbol
 * @returns {Promise<{ pipSize: number, pipUsdPerLot: number, category: string, source: string, error?: string }>}
 */
export async function resolvePipValuePerLot(symbol) {
  const s = normalizePairSymbol(symbol);
  if (!s) {
    return { pipSize: 0.0001, pipUsdPerLot: 10, category: "forex", source: "default", error: "No pair selected" };
  }

  const cat = detectCategory(s);
  let rates = null;
  if (cat === "forex") {
    const { base, quote } = parseForexLegs(s);
    const needsRates = base === "USD" || (base !== "USD" && quote !== "USD");
    if (needsRates) {
      try {
        rates = await fetchUsdRates();
      } catch (e) {
        const partial = pipValuePerLotSync(s, null);
        if (partial.pipUsdPerLot != null) {
          return { ...partial, error: "" };
        }
        return {
          pipSize: partial.pipSize,
          pipUsdPerLot: 10,
          category: partial.category,
          source: "fallback",
          error: e instanceof Error ? e.message : "Rates unavailable",
        };
      }
    }
  }

  const resolved = pipValuePerLotSync(s, rates);
  if (resolved.pipUsdPerLot == null || !Number.isFinite(resolved.pipUsdPerLot)) {
    return {
      pipSize: resolved.pipSize,
      pipUsdPerLot: 10,
      category: resolved.category,
      source: "fallback",
      error: "Could not compute pip value for this pair",
    };
  }

  return {
    pipSize: resolved.pipSize,
    pipUsdPerLot: resolved.pipUsdPerLot,
    category: resolved.category,
    source: resolved.source,
    error: "",
  };
}

export function formatPipInfo(resolved) {
  if (!resolved) return "";
  if (resolved.loading) return "Calculating pip value…";
  if (resolved.error && !resolved.pipUsdPerLot) return resolved.error;
  const pip = resolved.pipSize;
  const usd = resolved.pipUsdPerLot;
  const pipStr =
    pip >= 0.1 ? pip.toFixed(2) : pip >= 0.01 ? pip.toFixed(3) : pip.toFixed(4);
  return (
    "Auto pip value: $" +
    usd.toFixed(2) +
    " / pip / standard lot · pip size " +
    pipStr +
    (resolved.source === "cross" || resolved.source === "usd-base" ? " · live FX rate" : "")
  );
}

export function calcLotSize(riskUsd, stopPips, pipUsdPerLot) {
  if (!Number.isFinite(riskUsd) || riskUsd <= 0) return NaN;
  if (!Number.isFinite(stopPips) || stopPips <= 0) return NaN;
  if (!Number.isFinite(pipUsdPerLot) || pipUsdPerLot <= 0) return NaN;
  return riskUsd / (stopPips * pipUsdPerLot);
}
