/**
 * report-package.mjs — Layer 1 data package for the Jarvis report engine.
 *
 * buildReportPackage(periodTrades, allTimeTrades, options)
 *   Assembles one structured object from pre-sliced trade arrays.
 *   The caller handles date windowing; Layer 2/3 handles report generation.
 *
 * fetchTradesForReport(userId, dateFrom, dateTo)
 *   Convenience wrapper: calls fetchAllTradesForAnalysis once and returns both
 *   the full all-time array and the date-filtered period slice.
 *   The underlying fetchAllTradesForAnalysis is unchanged.
 */

import {
  fetchAllTradesForAnalysis,
  buildOverview,
  buildBySession,
  buildByDay,
  buildBySessionDayAll,
  buildByPair,
  buildByDirection,
  buildByModel,
  buildNotionExtrasPatterns,
  buildOutcomeSequences,
  buildProgression,
} from "./analysis-engine.mjs";

import { buildObservations } from "./intelligence-file.mjs";

// ─── Fetch layer ──────────────────────────────────────────────────────────────

/**
 * Fetch all trades for userId from Supabase (exactly as the rest of the app
 * does), then return the full set alongside a date-filtered period slice.
 *
 * @param {string}      userId
 * @param {string|null} dateFrom  "YYYY-MM-DD" inclusive, or null for no lower bound
 * @param {string|null} dateTo    "YYYY-MM-DD" inclusive, or null for no upper bound
 * @returns {{ periodTrades: object[], allTimeTrades: object[] }}
 */
export async function fetchTradesForReport(userId, dateFrom = null, dateTo = null) {
  const allTrades = await fetchAllTradesForAnalysis(userId);

  if (!dateFrom && !dateTo) {
    return { periodTrades: allTrades, allTimeTrades: allTrades };
  }

  // Inclusive date range: dateFrom at start-of-day UTC, dateTo at end-of-day UTC
  const fromMs = dateFrom ? new Date(dateFrom + "T00:00:00Z").getTime() : -Infinity;
  const toMs   = dateTo   ? new Date(dateTo   + "T23:59:59Z").getTime() :  Infinity;

  const periodTrades = allTrades.filter((t) => {
    if (!t.date) return false;
    const ms = new Date(t.date).getTime();
    if (isNaN(ms)) return false;
    return ms >= fromMs && ms <= toMs;
  });

  return { periodTrades, allTimeTrades: allTrades };
}

// ─── Package assembler ────────────────────────────────────────────────────────

/**
 * Build the full Layer-1 data package from two pre-sliced trade arrays.
 * Every stat carries its sample size (n / total / decided) so the report
 * layer can distinguish findings from noise. Nothing is filtered out by
 * sample size at this layer — that judgement belongs to Layer 2/3.
 *
 * @param {object[]} periodTrades   Trades within the report window (caller-sliced)
 * @param {object[]} allTimeTrades  All trades ever for this user
 * @param {object}   options
 * @param {number}   [options.bucketDays=7]  Progression bucket width in days
 *                   (7 = weekly for a month window; 30 = monthly for a quarter)
 * @returns {object}
 */
export function buildReportPackage(periodTrades, allTimeTrades, options = {}) {
  const { bucketDays = 7 } = options;

  // Build all period-level stats that buildObservations needs (same shape as
  // runAnalysisEngine output so we can reuse the existing classifier as-is).
  // Use buildBySessionDayAll so every session×day combo is present with its n —
  // the observation classifier applies its own min-sample gate internally.
  const allPatterns = buildNotionExtrasPatterns(periodTrades, Infinity);

  const periodRaw = {
    tradeCount:           periodTrades.length,
    overview:             buildOverview(periodTrades),
    bySession:            buildBySession(periodTrades),
    byDay:                buildByDay(periodTrades),
    bySessionDay:         buildBySessionDayAll(periodTrades),
    byModel:              buildByModel(periodTrades),
    byPair:               buildByPair(periodTrades),
    byDirection:          buildByDirection(periodTrades),
    notionExtrasPatterns: allPatterns,
  };

  return {
    generatedAt:       new Date().toISOString(),
    periodTradeCount:  periodTrades.length,
    allTimeTradeCount: allTimeTrades.length,

    // ── 1. Headline metrics: period vs all-time, side by side ──────────────
    // Every field in buildOverview output carries total / decided (sample sizes).
    headline: {
      period:  periodRaw.overview,
      allTime: buildOverview(allTimeTrades),
    },

    // ── 2. Breakdowns over the period ──────────────────────────────────────
    // Every row carries: key, total, wins, losses, bes, decided (n),
    // winRate, avgRRWin, avgRRLoss, expectancy, totalR, bestRR, worstRR.
    breakdowns: {
      bySession:    periodRaw.bySession,
      byDay:        periodRaw.byDay,
      bySessionDay: periodRaw.bySessionDay,  // all combos, no min-sample filter
      byPair:       periodRaw.byPair,
      byDirection:  periodRaw.byDirection,
      byModel:      periodRaw.byModel,
    },

    // ── 3. Custom field correlations: all qualifying patterns (no top-5 cap)
    // Each pattern: { key, value, count (n), winRateWith, winRateWithout, diff }
    // Minimum: 5 occurrences AND 5 decided trades on each side (existing gate).
    customFieldPatterns: allPatterns,

    // ── 4. Classified observations (green / red flags) ─────────────────────
    // Reuses the existing intelligence-file classifier with its tunable
    // thresholds (OBS_THRESHOLDS). Each flag carries sampleSize, winRate,
    // delta, strength. Scoped to period data.
    observations: buildObservations(periodRaw),

    // ── 5. Outcome sequences (NEW) ────────────────────────────────────────
    // Transition probabilities between consecutive trade outcomes.
    // afterWin / afterLoss / afterBE each: { n, pWin, pLoss, pBE,
    //   countWin, countLoss, countBE }
    outcomeSequences: buildOutcomeSequences(periodTrades),

    // ── 6. Sub-period progression (NEW) ───────────────────────────────────
    // periodTrades bucketed into windows of bucketDays.
    // Each bucket: { from, to, n, total, wins, losses, bes, decided,
    //   winRate, avgRRWin, avgRRLoss, expectancy, totalR, bestRR, worstRR }
    progression: buildProgression(periodTrades, bucketDays),
  };
}
