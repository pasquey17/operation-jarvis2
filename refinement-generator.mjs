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

SELECTION CRITERIA:
- A finding qualifies if: n ≥ 8 AND |delta (win rate difference)| ≥ 15 percentage points
- Prefer n ≥ 15 — set confidence "high". Set confidence "early_signal" for n 8-14.
- Ignore marginal findings (|delta| < 15pp after filtering). Better 2 sharp findings than 5 mediocre ones.
- NEVER pick circular/outcome-tautology findings.

IMPACT SCORE = Math.abs(delta_pp) × Math.min(n, 30) / 30
(Where delta_pp is the win rate difference in percentage points, e.g. 22 for a 22pp gap)

THE ONE THING:
Pick the single finding with the highest impact score. This is what the trader should change FIRST.
- If it's a leak (negative delta): "STOP / NEVER / CUT" — direct, hard verb
- If it's an edge (positive delta): "ONLY / DO MORE / ALWAYS" — direct, hard verb
One sentence. Backed by the number. No softening language.

LEAN IN (2-4 items): genuine edges. delta > +15pp AND n ≥ 8. Specific and actionable.
CUT OUT (2-4 items): genuine leaks. delta < -15pp AND n ≥ 8. Something the trader can actually stop doing.

RULES:
- The one_thing MUST NOT appear in lean_in or cut_out arrays (no duplication)
- If fewer than 2 lean_in qualify, return what qualifies (even 0 or 1)
- If fewer than 2 cut_out qualify, return what qualifies
- If nothing qualifies for a section, return empty array []

CONTRADICTION CHECK (run this before finalising — mandatory):
- Scan every pair of (lean_in item, cut_out item) for label/finding overlap: same field name, same session, or one being a subset of the other (e.g. "HTF weak structure" lean-in vs "weak structure" cut-out).
- If they point OPPOSITE ways for the SAME underlying condition: drop the less specific or weaker one. Only the sharper, better-evidenced finding survives.
- If they are GENUINELY DIFFERENT conditions that share similar words (e.g. "HTF weak structure WITH specific confluence" lean-in vs "generic weak structure entry" cut-out): BOTH may appear, but add a "reconcile_note" string field to EACH explaining the distinction in one plain-language sentence (e.g. "This refers to HTF weak structure with the structure confluence filter applied — different from a generic weak structure entry").
- Never output a plan where the same concept appears on opposite sides without a reconcile_note. If you cannot write a clear one-sentence reconciliation, drop the weaker finding instead.

Return this exact JSON shape:
{
  "one_thing": {
    "direction": "lean_in",
    "label": "Prescriptive title, max 10 words",
    "finding": "The specific pattern/condition (e.g. 'Asia session', 'HTF Bias: Bearish')",
    "instruction": "Single hard instruction. Strong verb first: Stop/Only/Never/Add/Cut/Double down on.",
    "proof": "The key number(s) that prove it (e.g. '22% WR vs 41% baseline · n=18 · -6.2R')",
    "n": 18,
    "confidence": "high"
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
      "reconcile_note": "optional — only present when this finding shares similar words with a cut_out item but is genuinely distinct"
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
      "reconcile_note": "optional — only present when this finding shares similar words with a lean_in item but is genuinely distinct"
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
    // For custom_field observations: include with/without rates
    wr_with:    o.evidence?.winRateWith  != null ? Math.round(o.evidence.winRateWith  * 100) : undefined,
    wr_without: o.evidence?.winRateWithout != null ? Math.round(o.evidence.winRateWithout * 100) : undefined,
  }));

  // Top 30 custom field patterns by |diff| — supplementary data beyond what's already in observations
  const customPatterns = (pkg.customFieldPatterns ?? []).slice(0, 30).map((p) => ({
    key:          p.key,
    value:        p.value,
    n:            p.count,
    wr_with_pct:  p.winRateWith    != null ? Math.round(p.winRateWith    * 100) : null,
    wr_without_pct: p.winRateWithout != null ? Math.round(p.winRateWithout * 100) : null,
    diff_pp:      p.diff != null ? Math.round(p.diff * 100) : null,
  }));

  return { overallWR, periodTrades: pkg.periodTradeCount, observations, customPatterns };
}

function buildPlanUserContent(input) {
  return `Baseline: ${input.overallWR ?? "n/a"}% win rate across ${input.periodTrades ?? 0} trades (last 90 days).

CLASSIFIED OBSERVATIONS (pre-ranked strongest first — use these as primary candidates):
${JSON.stringify(input.observations, null, 1)}

ADDITIONAL CUSTOM FIELD PATTERNS (win rate with vs without each condition):
${JSON.stringify(input.customPatterns, null, 1)}

Pick THE ONE THING and lean_in / cut_out. Return JSON only.`;
}

function buildWriteSystemPrompt() {
  return `You are writing a Refinements coaching report — a focused, prescriptive coaching document. Return ONLY valid HTML from <!DOCTYPE html> to </html>. No markdown, no fences, nothing before or after.

VOICE: Direct coach. Every claim backed by a number. No filler, no hedging except for genuine early_signal findings (flag those honestly). Never say "you may want to consider" — say "Stop" or "Only" or "Double down".

STRUCTURE (write in this exact order):
1. Compact page header: Google Fonts + Chart.js CDN in <head> (even though no charts needed, include for consistency). Title "REFINEMENTS" using .report-title. Below it: date using .report-period. Below that a small subtitle: "90-day coaching snapshot · the few things that actually matter" using .report-meta.

2. THE ONE THING section — the hero. Use a full-width .finding-card:
   - Use finding-card--crisis for cut_out direction, finding-card--breakthrough for lean_in direction
   - .finding-tag with label "THE ONE THING"
   - .finding-title: the one_thing.label in large text
   - .one-thing-instruction: the one_thing.instruction in bold, imperative voice (this is the dominant element)
   - .finding-stat: the proof number
   - If confidence is early_signal, add a small inline note: "(Early signal — n=[n] trades, pattern is real but watch as data builds)"
   - Do NOT add explanation padding. The number says it. Move on.

3. LEAN IN section (if lean_in has items):
   - .section with .section-eyebrow "lean in" and .section-title "Your Proven Edge"
   - For each item: use a .coaching-card.coaching-card--lean
     - .coaching-card__label: the item label
     - .coaching-card__instruction: the instruction (bold, imperative)
     - .coaching-card__proof: the proof (mono font)
     - If early_signal: add <span class="early-signal">Early signal</span> after the label
     - If reconcile_note is present: add <p class="coaching-card__reconcile">Note: [reconcile_note]</p> after the proof

4. CUT OUT section (if cut_out has items):
   - .section with .section-eyebrow "cut out" and .section-title "What's Bleeding You"
   - For each item: use a .coaching-card.coaching-card--cut
     - Same structure as lean in cards (including reconcile_note if present)

5. Closing line — one sentence only:
   - .closing-line: "Focus: [one-line summary of the priority for next 90 days based on THE ONE THING]"

DO NOT include: metric grids (.g4/.g3/.g2), Chart.js charts, progression timelines, full breakdown tables. No commentary sections. No "here's what we found" paragraphs. The plan speaks for itself.

CSS FRAMEWORK — embed exactly in <style>:
${REPORT_CSS}

COMPONENT REFERENCE:

Finding card (THE ONE THING hero):
<div class="finding-card finding-card--crisis">
  <span class="finding-tag finding-tag--crisis">THE ONE THING</span>
  <h2 class="finding-title">Stop trading the Asia session</h2>
  <p class="one-thing-instruction"><strong>Stop taking trades in the Asia session entirely until your win rate recovers.</strong></p>
  <div class="finding-stat">22% WR · n=18 · -6.2R · baseline 41%</div>
</div>

Coaching card (lean in / cut out):
<div class="coaching-card coaching-card--lean">
  <div class="coaching-card__label">London Open · Asia-London Combo</div>
  <div class="coaching-card__instruction">Only trade the London Open session — this is where your edge concentrates.</div>
  <div class="coaching-card__proof">58% WR · n=24 · +8.4R · baseline +17pp</div>
</div>

Coaching card with reconcile note (when reconcile_note is present in plan):
<div class="coaching-card coaching-card--lean">
  <div class="coaching-card__label">HTF Weak Structure + Confluence</div>
  <div class="coaching-card__instruction">Only take HTF weak structure setups when the structure confluence filter is active.</div>
  <div class="coaching-card__proof">81% WR · n=17 · +12.1R · baseline +31pp</div>
  <p class="coaching-card__reconcile">Note: This refers specifically to HTF weak structure entries with the confluence filter confirmed — distinct from generic weak structure entries which drag your win rate down.</p>
</div>

The report must be a complete working HTML page. Close with </body></html>.`;
}

function buildWriteUserContent(filteredPkg, plan) {
  const ov = filteredPkg.headline?.period ?? {};
  const overallWR = ov.winRate != null ? Math.round(ov.winRate * 100) : "n/a";
  const periodTrades = filteredPkg.periodTradeCount ?? 0;
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return `Overall: ${overallWR}% win rate across ${periodTrades} trades (last 90 days). Generated: ${today}.

COACHING PLAN (use these numbers directly — do not invent or recalculate):
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
    maxTokens:  2000,
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
