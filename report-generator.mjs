/**
 * report-generator.mjs — Layer 2/3: two-step Sonnet report engine.
 *
 * Step 1 (PLAN):  Send the filtered data package to Sonnet acting as report editor.
 *                 Returns a structured JSON editorial plan.
 * Step 2 (WRITE): Send plan + package to Sonnet to write fully-rendered HTML.
 *
 * generateReport(pkg, windowLabel) → HTML string
 */

import { isOutcomeTautology, isSegmentTag } from "./intelligence-file.mjs";

const REPORT_PLAN_MODEL  = "claude-haiku-4-5-20251001"; // Step 1: structured JSON extraction — Haiku is ~5× faster, quality unchanged
const REPORT_WRITE_MODEL = "claude-sonnet-4-6";          // Step 2: creative HTML authoring — Sonnet stays
const ANTHROPIC_VERSION  = "2023-06-01";

// ─── Pre-filter: strip tautologies and segment tags BEFORE sending to model ───

function filterPackage(pkg) {
  const clean = (patterns) =>
    (patterns ?? []).filter(
      (p) => !isOutcomeTautology(p.key, p.value) && !isSegmentTag(p.key, p.value)
    );

  // Also strip observations whose label references a tautology/segment pattern
  const cleanObs = (obs) =>
    (obs ?? []).filter((o) => {
      if (o.category !== "custom_field") return true;
      // observations carry evidence but not key/value directly; check label string
      const label = String(o.label ?? "");
      const m = label.match(/"([^:]+):\s*([^"]+)"/);
      if (!m) return true;
      return !isOutcomeTautology(m[1], m[2]) && !isSegmentTag(m[1], m[2]);
    });

  return {
    ...pkg,
    customFieldPatterns: clean(pkg.customFieldPatterns),
    observations:        cleanObs(pkg.observations),
  };
}

// ─── CSS framework (embedded in the write prompt and in the output <style>) ──

const REPORT_CSS = `
:root{--bg:#050a14;--blue:#00d4ff;--green:#00ff88;--red:#ff4466;--amber:#ff9a28;--text:#d8e8f4;--muted:#556677;--mono:'Share Tech Mono','Courier New',monospace;--sans:'Outfit',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.6;padding:48px 24px 100px}
.report-wrap{max-width:900px;margin:0 auto}
/* Header */
.report-meta{font-family:var(--mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.report-title{font-size:clamp(2rem,5vw,3.2rem);font-weight:200;color:#fff;letter-spacing:.04em;line-height:1.15;margin-bottom:8px}
.report-period{font-family:var(--mono);font-size:11px;color:var(--blue);letter-spacing:.12em;text-transform:uppercase;margin-bottom:40px}
/* Headline finding card */
.finding-card{border-radius:14px;padding:28px 32px;margin-bottom:48px}
.finding-card--crisis{background:rgba(255,68,102,.05);border:1px solid rgba(255,68,102,.35)}
.finding-card--breakthrough{background:rgba(0,255,136,.04);border:1px solid rgba(0,255,136,.3)}
.finding-card--mixed{background:rgba(0,212,255,.04);border:1px solid rgba(0,212,255,.25)}
.finding-tag{font-family:var(--mono);font-size:9px;letter-spacing:.18em;text-transform:uppercase;padding:3px 10px;border-radius:3px;display:inline-block;margin-bottom:14px}
.finding-tag--crisis{background:rgba(255,68,102,.18);color:var(--red)}
.finding-tag--breakthrough{background:rgba(0,255,136,.14);color:var(--green)}
.finding-tag--mixed{background:rgba(0,212,255,.14);color:var(--blue)}
.finding-title{font-size:1.55rem;font-weight:300;color:#fff;line-height:1.25;margin-bottom:10px}
.finding-body{font-size:.93rem;color:rgba(216,232,244,.82);line-height:1.65;margin-bottom:14px}
.finding-stat{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--blue)}
/* Section */
.section{margin-bottom:56px}
.section-eyebrow{font-family:var(--mono);font-size:9px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.section-title{font-size:1.25rem;font-weight:300;color:#fff;letter-spacing:.03em;margin-bottom:8px}
.section-verdict{font-size:.9rem;color:rgba(216,232,244,.78);line-height:1.65;margin-bottom:20px}
/* Metric grids */
.g4,.g3,.g2{display:grid;gap:10px;margin-bottom:20px}
.g4{grid-template-columns:repeat(4,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g2{grid-template-columns:repeat(2,1fr)}
.metric-card{background:rgba(255,255,255,.03);border:1px solid rgba(0,212,255,.1);border-radius:10px;padding:16px 18px}
.metric-val{font-size:2rem;font-weight:200;color:#fff;line-height:1.1;font-variant-numeric:tabular-nums}
.metric-val--green{color:var(--green)}
.metric-val--red{color:var(--red)}
.metric-val--blue{color:var(--blue)}
.metric-val--amber{color:var(--amber)}
.metric-label{font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-top:5px}
.metric-sub{font-family:var(--mono);font-size:10px;color:rgba(85,102,119,.8);margin-top:2px}
/* Rule callouts */
.rule{border-radius:8px;padding:14px 18px;margin:10px 0;border-left:3px solid;display:flex;gap:12px;align-items:flex-start}
.rule--green{background:rgba(0,255,136,.05);border-color:var(--green)}
.rule--red{background:rgba(255,68,102,.05);border-color:var(--red)}
.rule--amber{background:rgba(255,155,40,.06);border-color:var(--amber)}
.rule--blue{background:rgba(0,212,255,.05);border-color:var(--blue)}
.rule-tag{font-family:var(--mono);font-size:9px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;flex-shrink:0;padding-top:1px}
.rule--green .rule-tag{color:var(--green)}
.rule--red .rule-tag{color:var(--red)}
.rule--amber .rule-tag{color:var(--amber)}
.rule--blue .rule-tag{color:var(--blue)}
.rule-text{font-size:.88rem;color:rgba(216,232,244,.88);line-height:1.55}
/* Charts */
.chart-wrap{background:rgba(255,255,255,.02);border:1px solid rgba(0,212,255,.08);border-radius:12px;padding:20px 20px 16px;margin-bottom:20px}
.chart-title{font-family:var(--mono);font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
/* Tags / chips */
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.chip{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:4px}
.chip--green{background:rgba(0,255,136,.1);color:var(--green);border:1px solid rgba(0,255,136,.25)}
.chip--red{background:rgba(255,68,102,.1);color:var(--red);border:1px solid rgba(255,68,102,.25)}
.chip--blue{background:rgba(0,212,255,.1);color:var(--blue);border:1px solid rgba(0,212,255,.2)}
.chip--amber{background:rgba(255,155,40,.1);color:var(--amber);border:1px solid rgba(255,155,40,.25)}
.chip--muted{background:rgba(255,255,255,.05);color:rgba(216,232,244,.55);border:1px solid rgba(255,255,255,.08)}
/* Divider */
hr.divider{border:none;border-top:1px solid rgba(0,212,255,.1);margin:32px 0}
/* Body text */
p{font-size:.9rem;color:rgba(216,232,244,.8);line-height:1.65;margin-bottom:12px}
strong{color:#fff;font-weight:500}
/* Responsive */
@media(max-width:600px){.g4{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:repeat(2,1fr)}.finding-card{padding:20px 18px}.report-title{font-size:1.8rem}}
`.trim();

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildPlanSystemPrompt() {
  return `You are the editor of a trading performance report. Analyse the data package and return a structured editorial plan.

CRITICAL: Return ONLY valid JSON — no markdown fences, no explanation, no text before or after. Start your response with { and end with }.

Your job:
1. Pick the SINGLE BIGGEST FINDING as the headline — one specific insight. Frame as crisis or breakthrough.
   Crisis example: "Sunday is bleeding your account — 14% WR, -5R this quarter"
   Breakthrough example: "Friday is your untapped edge — 47% WR vs 36% overall"
2. Select which sections to include. Skip sections with no meaningful signal:
   - Skip byModel if all keys are "N/A" or there is only one model
   - Skip any breakdown where all n values are below 10
   - Skip outcomeSequences if n < 20 for afterWin and afterLoss
   - Skip customFieldPatterns if the array is empty after filtering
   - Always include progression if there are ≥ 4 buckets
   - Always include derived_rules as the final section
3. Order sections: biggest finding first, supporting context after, derived_rules last.
4. For each section, list specific findings with their n (sample size). Hedge any finding with n < 15.

NEVER include: tautology fields (RR values, P&L values, Stop Loss Hit, Breakeven: true), segment tags (account-type labels, Forward-Test, testing phase). These have already been stripped from the package but double-check.

BREVITY: Keep each finding under 12 words. Max 5 findings per section. Max 7 sections total.

Return this exact JSON shape:
{
  "headline": {
    "type": "crisis" | "breakthrough" | "mixed",
    "title": "...",
    "body": "2 sentences max. Coach voice.",
    "key_stat": "e.g. 14% WR Sundays (n=7, -5R)"
  },
  "sections": [
    {
      "id": "session_breakdown" | "day_breakdown" | "pair_breakdown" | "direction_breakdown" | "combo_breakdown" | "custom_fields" | "sequences" | "progression" | "derived_rules",
      "title": "Short title",
      "findings": ["short finding with n", "..."]
    }
  ]
}`;
}

// Slim the package for the planning step — top patterns only, no full progression detail
function slimForPlanner(filteredPkg) {
  return {
    periodTradeCount:  filteredPkg.periodTradeCount,
    allTimeTradeCount: filteredPkg.allTimeTradeCount,
    headline: filteredPkg.headline,
    breakdowns: {
      bySession:    filteredPkg.breakdowns.bySession,
      byDay:        filteredPkg.breakdowns.byDay,
      byPair:       filteredPkg.breakdowns.byPair,
      byDirection:  filteredPkg.breakdowns.byDirection,
      // top 6 combos only
      bySessionDay: (filteredPkg.breakdowns.bySessionDay ?? []).slice(0, 6),
      // model only if meaningful
      byModel: (filteredPkg.breakdowns.byModel ?? []).filter(
        (r) => r.key && r.key !== "N/A" && (r.decided ?? 0) >= 10
      ),
    },
    // top 15 custom field patterns by |diff|
    customFieldPatterns: (filteredPkg.customFieldPatterns ?? []).slice(0, 15),
    // observations as-is (already short)
    observations: filteredPkg.observations,
    // sequence summary
    outcomeSequences: filteredPkg.outcomeSequences,
    // progression: just bucket count and date range summary
    progressionSummary: {
      bucketCount: (filteredPkg.progression ?? []).length,
      from: filteredPkg.progression?.[0]?.from ?? null,
      to:   filteredPkg.progression?.[(filteredPkg.progression?.length ?? 1) - 1]?.to ?? null,
      winRates: (filteredPkg.progression ?? []).map((b) => ({
        from: b.from, n: b.n, winRate: b.winRate, totalR: b.totalR
      })),
    },
  };
}

function buildPlanUserPrompt(filteredPkg, windowLabel) {
  const slim = slimForPlanner(filteredPkg);
  return `Window: ${windowLabel}
Period trades: ${slim.periodTradeCount}
All-time trades: ${slim.allTimeTradeCount}
Overall period win rate: ${slim.headline?.period?.winRate != null ? Math.round(slim.headline.period.winRate * 100) + '%' : 'n/a'}

DATA SUMMARY:
${JSON.stringify(slim, null, 1)}`;
}

function buildWriteSystemPrompt() {
  return `You are writing a complete standalone HTML trading performance report. Return ONLY valid HTML — the entire document from <!DOCTYPE html> to </html>. No markdown, no fences, nothing before or after the HTML.

VOICE:
- Coach: direct, brutally honest, invested. Never cold or clinical.
- Structure every section: verdict first, then the number that proves it, then the action.
- Never state a stat without saying what it means. Never leave a stat without a "so do this" conclusion.
- Small n (< 15 trades): hedge every claim. "Early signal — only N trades, but…"
- All numbers must come directly from the data package. Never invent or calculate.

HTML STRUCTURE:
Use the CSS framework below (embed it in <style>). Use Chart.js from CDN for charts.

${REPORT_CSS}

COMPONENT PATTERNS — use these exactly:

Headline card:
<div class="finding-card finding-card--crisis">
  <span class="finding-tag finding-tag--crisis">⚠ Crisis</span>
  <h2 class="finding-title">Sunday is bleeding your account</h2>
  <p class="finding-body">Body text here.</p>
  <div class="finding-stat">14% WR · -5.0R · n=7</div>
</div>

Metric grid (use g4/g3/g2 for 4/3/2 columns):
<div class="g4">
  <div class="metric-card">
    <div class="metric-val metric-val--green">47%</div>
    <div class="metric-label">Win Rate</div>
    <div class="metric-sub">n=17 trades</div>
  </div>
</div>

Rule callout (green/red/amber/blue):
<div class="rule rule--red">
  <span class="rule-tag">Rule 1</span>
  <span class="rule-text"><strong>Blacklist Sunday entries.</strong> 14% WR across 7 trades this quarter. -5R total. The session adds nothing; the loss exposure is real.</span>
</div>

Chart (bar chart example):
<div class="chart-wrap">
  <div class="chart-title">Win Rate by Day</div>
  <canvas id="chart-day" height="180"></canvas>
</div>
<script>
(function(){
  const ctx = document.getElementById('chart-day').getContext('2d');
  const wr = 0.36; // overall win rate from package
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Mon','Tue','Wed','Thu','Fri','Sun'],
      datasets: [{
        data: [0.35, 0.38, 0.40, 0.28, 0.47, 0.14],
        backgroundColor: [0.35,0.38,0.40,0.28,0.47,0.14].map(v => v >= wr+0.05 ? 'rgba(0,255,136,0.55)' : v <= wr-0.05 ? 'rgba(255,68,102,0.55)' : 'rgba(0,212,255,0.4)'),
        borderColor: [0.35,0.38,0.40,0.28,0.47,0.14].map(v => v >= wr+0.05 ? '#00ff88' : v <= wr-0.05 ? '#ff4466' : '#00d4ff'),
        borderWidth: 1, borderRadius: 4
      }]
    },
    options: {
      responsive:true, plugins:{legend:{display:false}},
      scales:{
        x:{grid:{color:'rgba(0,212,255,0.06)'},ticks:{color:'#556677',font:{family:'Share Tech Mono',size:10}}},
        y:{grid:{color:'rgba(0,212,255,0.06)'},ticks:{color:'#556677',font:{family:'Share Tech Mono',size:10},callback:v=>Math.round(v*100)+'%'},min:0,suggestedMax:0.8}
      }
    }
  });
})();
</script>

Line chart (progression) example:
<script>
(function(){
  const ctx = document.getElementById('chart-prog').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Jul 13','Jul 20','Jul 27'],
      datasets: [{
        data: [0.47, 0.13, 0.54],
        borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.07)',
        tension: 0.35, fill: true, pointBackgroundColor: '#00d4ff', pointRadius: 4
      }]
    },
    options: {
      responsive:true, plugins:{legend:{display:false}},
      scales:{
        x:{grid:{color:'rgba(0,212,255,0.06)'},ticks:{color:'#556677',font:{family:'Share Tech Mono',size:9},maxRotation:45}},
        y:{grid:{color:'rgba(0,212,255,0.06)'},ticks:{color:'#556677',font:{family:'Share Tech Mono',size:10},callback:v=>Math.round(v*100)+'%'},min:0,suggestedMax:0.8}
      }
    }
  });
})();
</script>

Section wrapper:
<div class="section">
  <div class="section-eyebrow">01 — Session</div>
  <h3 class="section-title">Asia is where your edge lives</h3>
  <p class="section-verdict">...</p>
  <!-- metrics, charts, rules here -->
</div>

LENGTH MANAGEMENT: You have a fixed token budget. Complete ALL sections — verdicts max 3 sentences, rules max 2 sentences each, max 3 rules per section. Better to be concise throughout than to run out of space before the derived rules. Always close the document properly with </body></html>.

IMPORTANT: Every <script> with Chart.js code must be wrapped in an IIFE (function(){...})() so chart IDs don't collide. Each chart's canvas must have a unique id. Include Google Fonts and Chart.js CDN in <head>. The report must be a complete working HTML page.`;
}

function buildWriteUserPrompt(filteredPkg, plan, windowLabel) {
  return `Write the performance report using this plan and data.

EDITORIAL PLAN:
${JSON.stringify(plan, null, 2)}

DATA PACKAGE (use these numbers only — never invent):
${JSON.stringify(filteredPkg, null, 1)}

Write the complete HTML now. Start with <!DOCTYPE html>.`;
}

// ─── Anthropic call helper ────────────────────────────────────────────────────

async function callAnthropic({ model, system, user, maxTokens, expectJson = false, cacheSystem = false }) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // When cacheSystem is true, wrap the system prompt as a content block with
  // cache_control so repeated calls (e.g. Regenerate) skip re-tokenising it.
  const systemPayload = cacheSystem
    ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
    : system;

  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
  if (cacheSystem) headers["anthropic-beta"] = "prompt-caching-2024-07-31";

  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPayload,
    messages: [{ role: "user", content: user }],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";

  if (expectJson) {
    // Strip any accidental markdown fences
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Try to extract the first JSON object
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error(`Plan step returned non-JSON: ${cleaned.slice(0, 200)}`);
    }
  }

  return text;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {object} pkg          Output of buildReportPackage
 * @param {string} windowLabel  Human label, e.g. "90-day (quarter)"
 * @returns {Promise<string>}   Complete standalone HTML report
 */
export async function generateReport(pkg, windowLabel = "period") {
  const filteredPkg = filterPackage(pkg);

  // ── Step 1: Plan ────────────────────────────────────────────────────────────
  console.log("[report-generator] Step 1: planning…");
  const plan = await callAnthropic({
    model:      REPORT_PLAN_MODEL,
    system:     buildPlanSystemPrompt(),
    user:       buildPlanUserPrompt(filteredPkg, windowLabel),
    maxTokens:  3000,
    expectJson: true,
  });
  console.log("[report-generator] Plan sections:", plan.sections?.map((s) => s.id).join(", "));

  // ── Step 2: Write ───────────────────────────────────────────────────────────
  console.log("[report-generator] Step 2: writing…");
  const html = await callAnthropic({
    model:       REPORT_WRITE_MODEL,
    system:      buildWriteSystemPrompt(),
    user:        buildWriteUserPrompt(filteredPkg, plan, windowLabel),
    maxTokens:   16000,
    cacheSystem: true,
  });

  // Ensure we return clean HTML
  const trimmed = html.trim();
  if (!trimmed.startsWith("<!")) {
    // Pluck out the HTML block if model added a preamble
    const m = trimmed.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
    if (m) return m[1];
  }
  return trimmed;
}
