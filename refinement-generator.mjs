/**
 * refinement-generator.mjs — Haiku plan + Sonnet stream for the Refinements report.
 *
 * The Refinements report is a coaching document: it reads everything the user tracks
 * over 90 days and surfaces the few things that actually matter — ranked by impact.
 *
 * planRefinementStep(pkg)                      → { filteredPkg, plan }
 * writeRefinementStream(filteredPkg, plan)     → AsyncGenerator<string>
 */

import { isOutcomeTautology, isSegmentTag } from "./intelligence-file.mjs";

const PLAN_MODEL  = "claude-haiku-4-5-20251001";
const WRITE_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";

// ─── Package filter (same logic as report-generator.mjs) ─────────────────────

function filterPackage(pkg) {
  const clean = (patterns) =>
    (patterns ?? []).filter(
      (p) => !isOutcomeTautology(p.key, p.value) && !isSegmentTag(p.key, p.value)
    );

  const cleanObs = (obs) =>
    (obs ?? []).filter((o) => {
      if (o.category !== "custom_field") return true;
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

// ─── Anthropic helpers (copied from report-generator.mjs — not exported there) ─

async function callAnthropic({ model, system, user, maxTokens, expectJson = false, cacheSystem = false }) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

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
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error(`Plan step returned non-JSON: ${cleaned.slice(0, 200)}`);
    }
  }

  return text;
}

async function* callAnthropicStream({ model, system, user, maxTokens, cacheSystem = false }) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

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
    stream: true,
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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const event = JSON.parse(data);
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          yield event.delta.text;
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}

// ─── CSS framework (same as report-generator.mjs) ────────────────────────────

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
/* Refinements-specific */
.one-thing-instruction{font-size:1.15rem;font-weight:400;color:#fff;line-height:1.4;margin-bottom:16px}
.coaching-card{border-radius:10px;padding:20px 24px;margin-bottom:16px}
.coaching-card--lean{background:rgba(0,255,136,.04);border:1px solid rgba(0,255,136,.2)}
.coaching-card--cut{background:rgba(255,68,102,.04);border:1px solid rgba(255,68,102,.25)}
.coaching-card__label{font-family:var(--mono);font-size:9px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px}
.coaching-card--lean .coaching-card__label{color:var(--green)}
.coaching-card--cut .coaching-card__label{color:var(--red)}
.coaching-card__instruction{font-size:.95rem;font-weight:500;color:#fff;margin-bottom:8px;line-height:1.4}
.coaching-card__proof{font-family:var(--mono);font-size:10px;letter-spacing:.08em;color:rgba(216,232,244,.55)}
.early-signal{font-family:var(--mono);font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);background:rgba(255,155,40,.1);border:1px solid rgba(255,155,40,.25);border-radius:3px;padding:2px 8px;display:inline-block;margin-left:8px;vertical-align:middle}
.closing-line{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:rgba(216,232,244,.4);text-align:center;padding:32px 0;border-top:1px solid rgba(0,212,255,.08)}
.coaching-card__reconcile{font-size:.8rem;color:rgba(255,155,40,.7);margin-top:8px;line-height:1.5;font-style:italic}
/* Responsive */
@media(max-width:600px){.finding-card{padding:20px 18px}.report-title{font-size:1.8rem}.coaching-card{padding:16px 18px}}
`.trim();

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildPlanSystemPrompt() {
  return `You are a trading coach reviewing 90 days of trade data. Your job: identify the FEW things that actually matter — findings strong enough to act on immediately.

CRITICAL: Return ONLY valid JSON. No markdown fences, no explanation, no text before or after. Start with { end with }.

═══ FT CONFOUND GUARD (read this first) ═══
This dataset mixes FORWARD TEST (paper/practice) trades with FUNDED/LIVE trades. The data layer has already stripped direct "Forward Test" segment observations. But indirect effects remain.

HARD EXCLUSIONS — never pick these as findings:
1. Any finding about a specific ACCOUNT or PROP FIRM account (e.g. "100k p2", "200k", "funded account", "p1 account", "p2 account", "challenge", any text ending in "k" account). When you see one account has lower WR than "without" — the "without" group is inflated by forward test trades. These findings are NEVER actionable edge. SKIP THEM.
2. Any finding where the key contains "account", "prop", "challenge", "phase" in any form.

RULE — session, model, and combo findings MUST include this reconcile_note verbatim:
"Verify this edge holds on your funded/live trades specifically — forward test trades are more selective and can inflate session and model signals."

custom_field findings (confluence tags, conditions, entry rules, risk rules, hold time) are NOT contaminated by this effect and do NOT need the FT reconcile_note.

═══ SESSION×MODEL PRIORITISATION ═══
The SESSION×MODEL CROSS-TAB is the highest-value data source. Check it first.
The key question: does the same model run 15+pp higher WR in one session vs another?
If yes, AND there are ≥8 decided trades on each side: THIS is THE ONE THING — a reallocation finding.
Instruction format: "Only take [Model] in [Better Session] — you're taking it [N]× more in [Worse Session] where it runs [X]% vs [Y]% in [Better Session]."

═══ SELECTION CRITERIA ═══
- Qualifies: n ≥ 8 AND |delta| ≥ 15 percentage points
- Prefer n ≥ 15 — set confidence "high". Set confidence "early_signal" for n 8–14.
- Ignore |delta| < 15pp. Better 2 sharp findings than 5 mediocre ones.
- NEVER pick circular/outcome-tautology findings (RR field, explicit win/loss labels).
- NON-OBVIOUS BAR: prefer combination/reallocation findings over flat session or model findings when the cross-tab shows the combination is the real source.

IMPACT SCORE = Math.abs(delta_pp) × Math.min(n, 30) / 30
(delta_pp = win rate gap in percentage points)

═══ THE ONE THING ═══
Single highest-impact finding. What to change FIRST.
- Leak (negative delta): STOP / NEVER / CUT — direct, hard verb
- Edge (positive delta): ONLY / DOUBLE DOWN ON / CONCENTRATE — direct, hard verb
- Reallocation: "Only take [X] in [Y] — you're taking it [N]× more in [Z] where it underperforms."
One sentence. Backed by the number. No softening.

═══ LEAN IN (2–4 items, max 4) ═══
Genuine edges: conditions where doing MORE of X increases WR. delta > +15pp AND n ≥ 8.
LEAN IN = "This positive condition is present — do it more." Instruction uses: ONLY / DOUBLE DOWN / CONCENTRATE.
Lead with the session×model combination if one qualifies.

MIXED-SIGNAL RULE: If a single data observation spans two groups with opposite directions (e.g. Tuesday 90% WR vs Monday 33% WR), CREATE TWO SEPARATE ITEMS:
- The positive group goes in lean_in: "Trade Tuesdays — 90% WR (early signal, n=10)"
- The negative group goes in cut_out: "Stop trading Mondays — 33% WR · n=12"

═══ CUT OUT (2–4 items, max 4) ═══
Genuine leaks: conditions where doing LESS of X increases WR. delta < −15pp AND n ≥ 8.
CUT OUT = "This negative condition is present — stop doing it." Instruction uses: STOP / NEVER / CUT.
Negative delta findings go here. NEVER put a negative-delta finding in lean_in.
Proof strings: WR%, n, delta only. Never add "(inverted instruction)" or similar meta-commentary.

═══ CONFIDENCE RULE ═══
- n ≥ 15 → confidence: "high"
- n < 15 → confidence: "early_signal"
Apply this strictly. Tuesday n=10 → early_signal. RR 4-5RR n=11 → early_signal.

═══ RULES ═══
- one_thing MUST NOT appear in lean_in or cut_out (no duplication)
- Max 4 items per section. If you have 5+, drop the weakest (lowest impact score).
- Return [] for empty sections
- All session/model/combo items MUST have reconcile_note (per FT CONFOUND GUARD)

═══ CONTRADICTION CHECK (mandatory before finalising) ═══
Scan every (lean_in, cut_out) pair for label/concept overlap.
- Same underlying condition in opposite directions → drop the weaker one.
- Similar words but genuinely DIFFERENT conditions (e.g. "HTF WEAK STRUCTURE" lean_in vs "WEAK STRUCTURE" cut_out) → BOTH survive, but each MUST have a reconcile_note: "HTF WEAK STRUCTURE is a specific higher-timeframe read (81% WR) — distinct from the generic WEAK STRUCTURE tag which at 56% WR is not discriminating."
- Never output a plan where the same concept appears on both sides without a reconcile_note.

Return this exact JSON shape:
{
  "one_thing": {
    "direction": "lean_in",
    "label": "Prescriptive title, max 10 words",
    "finding": "The specific pattern/condition",
    "instruction": "Single hard instruction. Strong verb first.",
    "proof": "Key numbers (e.g. '61% WR London · n=28 · +1.87R vs 37% Asia · n=94 · +0.81R')",
    "n": 28,
    "confidence": "high",
    "reconcile_note": "required for session/model/combo — see FT CONFOUND GUARD; omit only for custom_field findings"
  },
  "lean_in": [
    {
      "direction": "lean_in",
      "label": "...",
      "finding": "...",
      "instruction": "...",
      "proof": "...",
      "n": 0,
      "confidence": "high",
      "reconcile_note": "required for session/model/combo; optional for custom_field; required when finding overlaps with a cut_out item"
    }
  ],
  "cut_out": [
    {
      "direction": "cut_out",
      "label": "...",
      "finding": "...",
      "instruction": "...",
      "proof": "...",
      "n": 0,
      "confidence": "high",
      "reconcile_note": "optional — required when finding overlaps with a lean_in item"
    }
  ]
}`;
}

function buildPlanInput(pkg) {
  const ov = pkg.headline?.period ?? {};
  const overallWR = ov.winRate != null ? Math.round(ov.winRate * 100) : null;

  // Compact observation rows: only what the planner needs to rank impact
  const observations = (pkg.observations ?? []).map((o) => ({
    type:     o.type,
    category: o.category,
    label:    o.label,
    strength: o.strength,
    n:        o.evidence?.sampleSize ?? null,
    delta_pp: o.evidence?.delta != null ? Math.round(o.evidence.delta * 100) : null,
    wr_pct:   o.evidence?.winRate != null ? Math.round(o.evidence.winRate * 100) : null,
    totalR:   o.evidence?.totalR ?? null,
    wr_with:    o.evidence?.winRateWith    != null ? Math.round(o.evidence.winRateWith    * 100) : undefined,
    wr_without: o.evidence?.winRateWithout != null ? Math.round(o.evidence.winRateWithout * 100) : undefined,
  }));

  // Top 30 custom field patterns by |diff|
  const customPatterns = (pkg.customFieldPatterns ?? []).slice(0, 30).map((p) => ({
    key:            p.key,
    value:          p.value,
    n:              p.count,
    wr_with_pct:    p.winRateWith    != null ? Math.round(p.winRateWith    * 100) : null,
    wr_without_pct: p.winRateWithout != null ? Math.round(p.winRateWithout * 100) : null,
    diff_pp:        p.diff != null ? Math.round(p.diff * 100) : null,
  }));

  // Compact session breakdown
  const bySession = (pkg.breakdowns?.bySession ?? []).map((r) => ({
    session: r.key,
    n:       r.decided ?? 0,
    wr_pct:  r.winRate != null ? Math.round(r.winRate * 100) : null,
    totalR:  r.totalR ?? null,
    exp:     r.expectancy ?? null,
  }));

  // Compact model breakdown
  const byModel = (pkg.breakdowns?.byModel ?? []).map((r) => ({
    model:  r.key,
    n:      r.decided ?? 0,
    wr_pct: r.winRate != null ? Math.round(r.winRate * 100) : null,
    totalR: r.totalR ?? null,
    exp:    r.expectancy ?? null,
  }));

  // Session × model cross-tab — the key non-obvious data source (min 6 decided)
  const bySessionModel = (pkg.breakdowns?.bySessionModel ?? [])
    .filter((r) => (r.decided ?? 0) >= 6)
    .map((r) => ({
      session: r.session,
      model:   r.model,
      n:       r.decided ?? 0,
      wr_pct:  r.winRate != null ? Math.round(r.winRate * 100) : null,
      totalR:  r.totalR ?? null,
      exp:     r.expectancy ?? null,
    }));

  return { overallWR, periodTrades: pkg.periodTradeCount, bySession, byModel, bySessionModel, observations, customPatterns };
}

function buildPlanUserContent(input) {
  return `Baseline: ${input.overallWR ?? "n/a"}% WR across ${input.periodTrades ?? 0} trades (last 90 days).

SESSION × MODEL CROSS-TAB (check this first — n ≥ 6 per cell):
${JSON.stringify(input.bySessionModel, null, 1)}

SESSION BREAKDOWN:
${JSON.stringify(input.bySession, null, 1)}

MODEL BREAKDOWN:
${JSON.stringify(input.byModel, null, 1)}

CLASSIFIED OBSERVATIONS (pre-ranked strongest first):
${JSON.stringify(input.observations, null, 1)}

CUSTOM FIELD PATTERNS (win rate with vs without — confluence tags, conditions, rules, etc.):
${JSON.stringify(input.customPatterns, null, 1)}

Return JSON only.`;
}

function buildWriteSystemPrompt() {
  return `You are writing a Refinements coaching report. Return ONLY valid HTML from <!DOCTYPE html> to </html>. No markdown, no fences, nothing before or after.

VOICE: Sharp prescriptive coach. "Read everything, say little." Every claim is backed by exactly one proof line. No preamble. No "here's what we found." No filler between sections. The numbers speak — your job is to make them land.

Strong verbs only: Stop. Only. Never. Double down on. Cut. Concentrate.
Hedge only for genuine early_signal findings — flag them once, move on.

STRUCTURE (write in this exact order, nothing else):

1. PAGE HEADER
   - <head>: only Google Fonts link (Outfit 200,300,400,500,600 + Share Tech Mono). No Chart.js.
   - <h1 class="report-title">REFINEMENTS</h1>
   - <div class="report-period">[date]</div>
   - <div class="report-meta">90-day coaching snapshot · the few things that actually matter</div>

2. THE ONE THING (hero — dominant first element)
   Direction cut_out → .finding-card--crisis + .finding-tag--crisis
   Direction lean_in → .finding-card--breakthrough + .finding-tag--breakthrough
   - .finding-tag: "THE ONE THING"
   - .finding-title: the label (large, white, font-weight 300)
   - .one-thing-instruction: the instruction wrapped in <strong>. This is THE dominant element — no sentence before it, no sentence after it.
   - .finding-stat: the proof string exactly as written in the plan
   - If early_signal: add one parenthetical after stat: (Early signal — n=[n] · pattern is real, watch as data builds)
   - If reconcile_note in plan: <p class="coaching-card__reconcile">Note: [reconcile_note]</p> after the stat. NEVER omit it if present.
   - NOTHING ELSE. No extra paragraphs.

3. LEAN IN (only if lean_in array non-empty)
   <div class="section">
   <div class="section-eyebrow">lean in</div>
   <h2 class="section-title">Your Proven Edge</h2>
   Each item → <div class="coaching-card coaching-card--lean">
     <div class="coaching-card__label">[label][ <span class="early-signal">Early signal</span> if early_signal]</div>
     <div class="coaching-card__instruction">[instruction]</div>
     <div class="coaching-card__proof">[proof]</div>
     [<p class="coaching-card__reconcile">Note: [reconcile_note]</p> if reconcile_note present]

4. CUT OUT (only if cut_out array non-empty)
   <div class="section">
   <div class="section-eyebrow">cut out</div>
   <h2 class="section-title">What's Bleeding You</h2>
   Each item → <div class="coaching-card coaching-card--cut"> (identical structure)

5. CLOSING LINE (always present)
   <div class="closing-line">Focus: [one punchy sentence about the next 90 days, starts with a verb, based on THE ONE THING]</div>

ABSOLUTE DON'TS:
- No metric grids, no Chart.js, no progression tables, no commentary paragraphs
- No section introductions ("Here are the things...")
- No softening language ("you may want to consider")
- Do NOT invent numbers — use the proof string from the plan exactly
- Do NOT repeat THE ONE THING inside LEAN IN or CUT OUT

CSS FRAMEWORK — embed exactly in <style>, no modifications:
${REPORT_CSS}

COMPONENT REFERENCE (copy structure, replace content):

THE ONE THING — lean_in:
<div class="finding-card finding-card--breakthrough">
  <span class="finding-tag finding-tag--breakthrough">THE ONE THING</span>
  <h2 class="finding-title">Concentrate NC+Sweep in London, Not Asia</h2>
  <p class="one-thing-instruction"><strong>Only take your NC+Sweep model in the London session — you run it 3× more in Asia where it hits 37% WR vs 61% in London.</strong></p>
  <div class="finding-stat">London: 61% WR · n=28 · +1.87R · Asia: 37% WR · n=94 · +0.81R</div>
  <p class="coaching-card__reconcile">Note: Verify this edge holds on your funded/live trades specifically — forward test selectivity can inflate session signals.</p>
</div>

THE ONE THING — cut_out:
<div class="finding-card finding-card--crisis">
  <span class="finding-tag finding-tag--crisis">THE ONE THING</span>
  <h2 class="finding-title">Stop Every Re-entry</h2>
  <p class="one-thing-instruction"><strong>Never re-enter a trade — your re-entries run 19% WR and are the single biggest drain in your system.</strong></p>
  <div class="finding-stat">Re-entry: 19% WR · n=21 · −0.20R · vs original entry 45% WR · +1.12R</div>
</div>

LEAN IN card:
<div class="coaching-card coaching-card--lean">
  <div class="coaching-card__label">MTF Weak Structure — The Turbocharger</div>
  <div class="coaching-card__instruction">Only take trades where MTF Weak Structure is confirmed — your WR doubles when it's present.</div>
  <div class="coaching-card__proof">66% WR with · n=35 · +2.26R · vs 44% without · Δ+1.43R expectancy</div>
</div>

CUT OUT card:
<div class="coaching-card coaching-card--cut">
  <div class="coaching-card__label">SWEEP Tag — Decorative, Not Edge</div>
  <div class="coaching-card__instruction">Stop counting SWEEP as a confluence — it appears in 81% of trades and adds zero expectancy.</div>
  <div class="coaching-card__proof">Δ+0.03R · n=213 appearances · non-discriminating across any split</div>
</div>

Close with </body></html>.`;
}

function buildWriteUserContent(filteredPkg, plan) {
  const ov = filteredPkg.headline?.period ?? {};
  const overallWR = ov.winRate != null ? Math.round(ov.winRate * 100) : "n/a";
  const periodTrades = filteredPkg.periodTradeCount ?? 0;
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return `${overallWR}% WR · ${periodTrades} trades · last 90 days · ${today}

COACHING PLAN (use these numbers exactly — do not invent or recalculate):
${JSON.stringify(plan, null, 2)}

Write the complete refinements coaching report HTML now. Start with <!DOCTYPE html>.`;
}

// ─── Exported step functions ──────────────────────────────────────────────────

/**
 * Step 1 — run the Haiku plan step.
 * Returns before streaming starts so the caller can still send JSON error responses.
 *
 * @param {object} pkg  Output of buildReportPackage
 * @returns {{ filteredPkg: object, plan: object }}
 */
export async function planRefinementStep(pkg) {
  const filteredPkg = filterPackage(pkg);
  const input = buildPlanInput(filteredPkg);

  console.log("[refinement-generator] Step 1: planning…");
  const plan = await callAnthropic({
    model:      PLAN_MODEL,
    system:     buildPlanSystemPrompt(),
    user:       buildPlanUserContent(input),
    maxTokens:  3500,
    expectJson: true,
  });
  console.log(
    "[refinement-generator] Plan: ONE THING=%s, lean_in=%d, cut_out=%d",
    plan.one_thing?.label ?? "?",
    plan.lean_in?.length ?? 0,
    plan.cut_out?.length ?? 0,
  );
  return { filteredPkg, plan };
}

/**
 * Step 2 — async generator that streams the Sonnet write step.
 * Caller accumulates chunks for caching; each chunk is raw HTML text.
 *
 * @param {object} filteredPkg  From planRefinementStep
 * @param {object} plan         From planRefinementStep
 * @yields {string} raw HTML text chunks
 */
export async function* writeRefinementStream(filteredPkg, plan) {
  console.log("[refinement-generator] Step 2: writing (streaming)…");
  yield* callAnthropicStream({
    model:       WRITE_MODEL,
    system:      buildWriteSystemPrompt(),
    user:        buildWriteUserContent(filteredPkg, plan),
    maxTokens:   12000,
    cacheSystem: true,
  });
}
