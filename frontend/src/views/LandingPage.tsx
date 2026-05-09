import { motion } from "framer-motion";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function LandingPage() {
  return (
    <div className="space-y-14">
      <section className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[color:var(--panel)] p-8 shadow-[0_18px_60px_rgba(0,0,0,0.52)] backdrop-blur-2xl md:p-12">
        <div className="pointer-events-none absolute inset-0 opacity-[0.9] [background:radial-gradient(900px_480px_at_15%_0%,rgba(0,212,255,0.18),transparent_62%),radial-gradient(700px_520px_at_86%_20%,rgba(140,120,255,0.14),transparent_60%)]" />
        <div className="relative grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-center">
          <div>
            <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">
              AI TRADING OPERATING SYSTEM
            </p>
            <h1 className="mt-4 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-6xl">
              Your edge deserves <span className="text-white/90">consistency</span>.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-[15px] leading-[1.7] text-white/70 md:text-[16px]">
              Jarvis is emotional-performance software disguised as a trading
              platform. It learns your history, spots your patterns, and keeps
              you aligned with the trader you want to be.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button as="a" href="/app/onboarding/" variant="primary">
                START ONBOARDING
              </Button>
              <Button as="a" href="/app/pricing/" variant="secondary">
                VIEW PRICING
              </Button>
              <span className="font-mono text-[10px] tracking-[0.16em] text-white/35">
                No new backend. Pure frontend overlay.
              </span>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-[18px] border border-white/10 bg-[color:var(--panel2)] p-5"
          >
            <div className="pointer-events-none absolute inset-0 opacity-[0.8] [background:radial-gradient(700px_420px_at_20%_0%,rgba(0,212,255,0.14),transparent_55%)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">
                  DASHBOARD PREVIEW
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-white/55">
                  LIVE
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="rounded-[14px] border border-white/10 bg-black/25 p-4">
                  <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">
                    DAILY FOCUS
                  </p>
                  <p className="mt-2 text-[14px] leading-[1.55] text-white/78">
                    Protect your A+ criteria. No impulse entries after a loss.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Metric label="WIN-RATE" value="—" />
                  <Metric label="AVG R:R" value="—" />
                  <Metric label="EXPECTANCY" value="—" />
                </div>
                <div className="rounded-[14px] border border-white/10 bg-black/25 p-4">
                  <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">
                    COACHING MEMORY
                  </p>
                  <p className="mt-2 text-[13px] leading-[1.6] text-white/72">
                    “When you take a loss on XAUUSD, you rush the next entry.
                    We’ve seen it before. Slow down.”
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <Feature title="Psychology-aware" desc="Jarvis tracks the moment you slip — not just the trade." />
        <Feature title="Built around one edge" desc="Setup validation and reminders tied to your own history." />
        <Feature title="Calm, premium UX" desc="Designed to ground you. No clutter. No hype." />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card eyebrow="THE PROBLEM" meta="WHY TRADERS FAIL">
          <ul className="space-y-3 text-[14px] leading-[1.7] text-white/72">
            <li>Inconsistency beats edge.</li>
            <li>Emotional mistakes compound quietly.</li>
            <li>Patterns repeat because they’re not named.</li>
          </ul>
        </Card>
        <Card eyebrow="WHAT JARVIS DOES" meta="SYSTEM LAYER">
          <ul className="space-y-3 text-[14px] leading-[1.7] text-white/72">
            <li>Journaling + clean trade capture.</li>
            <li>Memory that references dates/instruments/setups.</li>
            <li>Live coaching that keeps you aligned mid-session.</li>
          </ul>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
        <Card eyebrow="AI MEMORY SYSTEM" meta="DATED EVIDENCE">
          <div className="space-y-3 text-[14px] leading-[1.7] text-white/72">
            <Quote
              label="Example"
              text='“Revenge traded on XAUUSD after two consecutive losses on 14 April (London).”'
            />
            <Quote
              label="Example"
              text='“Skipped your A+ model twice on 21 April, then forced an entry late session.”'
            />
            <p className="text-white/60">
              No vague labels. Jarvis anchors patterns to real moments.
            </p>
          </div>
        </Card>
        <Card eyebrow="LIVE COACHING" meta="IN THE MOMENT">
          <div className="space-y-3 text-[14px] leading-[1.7] text-white/72">
            <Quote label="Jarvis" text="This isn’t your model. Stand down." />
            <Quote label="Jarvis" text="You’re chasing. Reset your breathing. One clean setup only." />
            <Quote label="Jarvis" text="If you’re upset, your next trade is a liability." />
          </div>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <Card eyebrow="JOURNAL" meta="CAPTURE">
          <p className="text-[14px] leading-[1.7] text-white/72">
            Log trades fast. Store context. Keep the story of your execution clean.
          </p>
        </Card>
        <Card eyebrow="WEEKLY REVIEW" meta="AUTOMATED">
          <p className="text-[14px] leading-[1.7] text-white/72">
            Rule-break audit, psychology insights, and performance trends — grounded in your data.
          </p>
        </Card>
        <Card eyebrow="MARKET CONTEXT" meta="AWARE">
          <p className="text-[14px] leading-[1.7] text-white/72">
            Session windows, timers, and context prompts. Calm guidance, not noise.
          </p>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <Card eyebrow="TESTIMONIALS" meta="PLACEHOLDERS">
          <div className="space-y-3 text-[14px] leading-[1.7] text-white/72">
            <Quote label="Trader" text="“This feels like it’s watching my habits — not my PnL.”" />
            <Quote label="Trader" text="“The reminders stop me from spiraling after a loss.”" />
          </div>
        </Card>
        <Card eyebrow="READY" meta="START">
          <p className="text-[14px] leading-[1.7] text-white/72">
            Begin onboarding. Jarvis will calibrate your OS layer and drop you into mission control.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button as="a" href="/app/onboarding/" variant="primary">
              BEGIN CALIBRATION
            </Button>
            <Button as="a" href="/app/pricing/" variant="secondary">
              SEE PRICING
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/10 bg-black/25 p-4">
      <p className="font-mono text-[9px] tracking-[0.18em] text-white/40">
        {label}
      </p>
      <p className="mt-2 font-mono text-[16px] tracking-[0.08em] text-white/85">
        {value}
      </p>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-[color:var(--panel2)] p-6 backdrop-blur-2xl transition hover:border-white/20 hover:bg-white/[0.06]">
      <p className="font-mono text-[10px] tracking-[0.2em] text-[color:rgba(0,212,255,0.85)]">
        {title.toUpperCase()}
      </p>
      <p className="mt-3 text-[14px] leading-[1.7] text-white/70">{desc}</p>
    </div>
  );
}

function Quote({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
      <p className="font-mono text-[10px] tracking-[0.2em] text-white/50">
        {label.toUpperCase()}
      </p>
      <p className="mt-2 text-[14px] leading-[1.7] text-white/75">{text}</p>
    </div>
  );
}

