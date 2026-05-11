import { motion, MotionConfig } from "framer-motion";
import { Button } from "../ui/Button";

const ease = [0.22, 1, 0.36, 1] as const;

export function LandingPage() {
  return (
    <MotionConfig transition={{ duration: 0.65, ease }}>
      <div className="space-y-12 md:space-y-14">
        <SectionShell delay={0}>
          <HeroSection />
        </SectionShell>
        <SectionShell delay={0.05}>
          <ProblemStatic />
        </SectionShell>
        <SectionShell delay={0.05}>
          <SystemStatic />
        </SectionShell>
        <SectionShell delay={0.05}>
          <MemoryStatic />
        </SectionShell>
        <SectionShell delay={0.05}>
          <CoachingStatic />
        </SectionShell>
        <SectionShell delay={0.05}>
          <ReviewStatic />
        </SectionShell>
        <SectionShell delay={0.05}>
          <CtaStatic />
        </SectionShell>
      </div>
    </MotionConfig>
  );
}

function SectionShell({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease }}
      className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[color:rgba(0,0,0,0.20)] shadow-[0_22px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.95]">
        <div className="absolute inset-0 [background:radial-gradient(1100px_700px_at_18%_-10%,rgba(0,212,255,0.22),transparent_58%),radial-gradient(900px_620px_at_88%_10%,rgba(140,120,255,0.18),transparent_62%)]" />
        <div className="absolute inset-0 opacity-[0.45] [background:linear-gradient(180deg,rgba(255,255,255,0.06),transparent_36%)]" />
        <div className="absolute inset-0 opacity-[0.25] [background:radial-gradient(900px_560px_at_50%_30%,transparent_40%,rgba(0,0,0,0.85)_100%)]" />
      </div>
      <div className="relative px-6 py-14 md:px-10 md:py-14">{children}</div>
    </motion.section>
  );
}

function HeroSection() {
  const words = ["Your", "edge", "deserves", "consistency."];
  return (
    <div className="w-full max-w-[980px] text-center mx-auto">
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease }}
        className="font-mono text-[10px] tracking-[0.28em] text-white/55"
      >
        AI TRADING OPERATING SYSTEM
      </motion.p>

      <h1 className="mt-5 text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
        {words.map((word, i) => (
          <motion.span
            key={word + i}
            initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: i * 0.08, ease }}
            className="inline-block mr-[0.22em]"
          >
            {word}
          </motion.span>
        ))}
      </h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.55, delay: 0.38, ease }}
        className="mx-auto mt-6 max-w-[52ch] text-pretty text-[15px] leading-[1.8] text-white/70 md:text-[16px]"
      >
        Jarvis is a living system that learns your patterns and protects you
        from self-sabotage — with dated, instrument-specific memory.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.5, ease }}
        className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
      >
        <Button as="a" href="/app/onboarding/" variant="primary">
          START CALIBRATION
        </Button>
        <Button as="a" href="/app/pricing/" variant="secondary">
          VIEW PRICING
        </Button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.62, ease }}
        className="mt-10 grid gap-4 md:grid-cols-3"
      >
        <HeroChip label="MEMORY" value="DATED" />
        <HeroChip label="COACHING" value="LIVE" />
        <HeroChip label="EXECUTION" value="PROTECTED" />
      </motion.div>
    </div>
  );
}

function ProblemStatic() {
  return (
    <div className="w-full max-w-[980px] mx-auto">
      <div className="grid gap-6 md:grid-cols-2 md:items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease }}
        >
          <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">PROBLEM</p>
          <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
            It's not your strategy.
            <br />
            It's your state.
          </h2>
          <p className="mt-4 max-w-[52ch] text-[14px] leading-[1.8] text-white/68">
            Traders don't fail from a lack of information. They fail from
            inconsistency, emotional drift, and repeating the same pattern
            without naming it.
          </p>
        </motion.div>
        <div className="space-y-3">
          {[
            { title: "After a loss", line: "Impulse entries masquerade as "revenge."" },
            { title: "After a win", line: "Overconfidence widens the rules quietly." },
            { title: "Under pressure", line: "You abandon process to chase outcome." },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: i * 0.1, ease }}
            >
              <ProblemCard title={item.title} line={item.line} />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SystemStatic() {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] items-center gap-8 md:grid-cols-[0.95fr_1.05fr]">
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">SYSTEM INTRO</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
          This isn't a dashboard.
          <br />
          It's an operating system.
        </h2>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.8] text-white/68">
          Journal, analytics, and coaching aren't separate tools. Jarvis
          connects them so your patterns become obvious — and actionable.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Pill>JOURNAL</Pill>
          <Pill>MEMORY</Pill>
          <Pill>COACHING</Pill>
          <Pill>REVIEWS</Pill>
        </div>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.65, ease }}
        className="relative"
      >
        <OsMock />
      </motion.div>
    </div>
  );
}

function MemoryStatic() {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] items-center gap-8 md:grid-cols-2">
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">MEMORY MOMENT</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
          Jarvis remembers the moment you drift.
        </h2>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.8] text-white/68">
          Not vague labels. Not "you overtrade." Real anchors: dates, pairs,
          setups — so you can spot the loop before it repeats.
        </p>
      </div>
      <div className="space-y-3">
        {[
          { label: "RECENT PATTERN", text: "Revenge traded on XAUUSD after two consecutive losses on 14 April (London)." },
          { label: "SETUP DRIFT", text: "Skipped your A+ model twice on 21 April, then forced an entry late session." },
          { label: "RISK SIGNAL", text: "When RR dips below 1.0, you start hunting instead of waiting." },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.12, ease }}
          >
            <MemoryLine label={item.label} text={item.text} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function CoachingStatic() {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease }}
      >
        <CoachingOverlay />
      </motion.div>
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">LIVE COACHING</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
          It stops the next mistake.
        </h2>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.8] text-white/68">
          In-session, Jarvis is fast. Direct. Calm. It helps you stay aligned
          to your own rules when emotions spike.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Pill tone="good">VALIDATE SETUP</Pill>
          <Pill tone="bad">WARN DRIFT</Pill>
          <Pill>RESET STATE</Pill>
        </div>
      </div>
    </div>
  );
}

function ReviewStatic() {
  return (
    <div className="mx-auto grid w-full max-w-[1100px] items-center gap-8 md:grid-cols-2">
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">WEEKLY REVIEW</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
          The week gets compressed into clarity.
        </h2>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.8] text-white/68">
          Automation that surfaces the truth: rule breaks, session edge, and
          the psychological triggers that cost you.
        </p>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease }}
      >
        <ReviewMock />
      </motion.div>
    </div>
  );
}

function CtaStatic() {
  return (
    <div className="w-full max-w-[980px] text-center mx-auto">
      <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">FINAL CTA</p>
      <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.03] tracking-[-0.04em] text-white md:text-6xl">
        Stop repeating the same month.
        <br />
        Install your system.
      </h2>
      <p className="mx-auto mt-6 max-w-[56ch] text-pretty text-[14px] leading-[1.85] text-white/68 md:text-[15px]">
        Jarvis is built to keep you grounded and consistent — with memory that
        feels like it's been watching you for months.
      </p>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2, ease }}
        className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
      >
        <Button as="a" href="/app/onboarding/" variant="primary">
          START CALIBRATION
        </Button>
        <Button as="a" href="/app/pricing/" variant="secondary">
          SEE PRICING
        </Button>
      </motion.div>
    </div>
  );
}

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-2xl">
      <p className="font-mono text-[10px] tracking-[0.22em] text-white/45">{label}</p>
      <p className="mt-2 font-mono text-[12px] tracking-[0.18em] text-white/80">{value}</p>
    </div>
  );
}

function ProblemCard({ title, line }: { title: string; line: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
      <p className="font-mono text-[10px] tracking-[0.22em] text-white/45">{title.toUpperCase()}</p>
      <p className="mt-2 text-[14px] leading-[1.7] text-white/75">{line}</p>
    </div>
  );
}

function MemoryLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
      <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.82)]">{label}</p>
      <p className="mt-2 text-[14px] leading-[1.7] text-white/75">{text}</p>
    </div>
  );
}

function Pill({ children, tone }: { children: string; tone?: "good" | "bad" }) {
  const cls =
    tone === "good"
      ? "border-[color:rgba(0,255,136,0.22)] bg-[color:rgba(0,255,136,0.08)] text-[color:rgba(0,255,136,0.9)]"
      : tone === "bad"
        ? "border-[color:rgba(255,80,80,0.22)] bg-[color:rgba(255,80,80,0.08)] text-[color:rgba(255,80,80,0.9)]"
        : "border-white/10 bg-white/5 text-white/70";
  return (
    <span className={"rounded-full border px-3 py-2 font-mono text-[10px] tracking-[0.18em] " + cls}>
      {children}
    </span>
  );
}

function OsMock() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[color:rgba(0,0,0,0.25)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 opacity-[0.85] [background:radial-gradient(700px_420px_at_20%_0%,rgba(0,212,255,0.14),transparent_55%)]" />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">JARVIS OS</p>
          <span className="rounded-full border border-[color:rgba(0,212,255,0.25)] bg-[color:rgba(0,212,255,0.08)] px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(0,212,255,0.9)]">
            LIVE
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
            <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">DAILY FOCUS</p>
            <p className="mt-2 text-[14px] leading-[1.65] text-white/78">One clean setup. No impulse entries after a loss.</p>
          </div>
          <div className="rounded-[18px] border border-[color:rgba(0,212,255,0.16)] bg-black/20 p-5">
            <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">SESSION EDGE</p>
            <p className="mt-2 font-mono text-[18px] tracking-[0.08em] text-[color:rgba(0,212,255,0.9)]">LONDON</p>
          </div>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
          <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">MEMORY</p>
          <p className="mt-2 text-[13px] leading-[1.7] text-white/75">
            "On 14 April you forced XAUUSD after a loss. This is that moment."
          </p>
        </div>
      </div>
    </div>
  );
}

function CoachingOverlay() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[color:rgba(0,0,0,0.25)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 opacity-[0.7] [background:radial-gradient(700px_420px_at_80%_20%,rgba(0,212,255,0.14),transparent_55%)]" />
      <div className="relative space-y-3">
        <OverlayMsg tone="bad" text="Stand down. This isn't your model." />
        <OverlayMsg tone="neutral" text="Breathe. Find the A+ criteria again." />
        <OverlayMsg tone="good" text="This matches your edge. Execute clean." />
      </div>
    </div>
  );
}

function OverlayMsg({ tone, text }: { tone: "good" | "bad" | "neutral"; text: string }) {
  const cls =
    tone === "good"
      ? "border-[color:rgba(0,255,136,0.22)] bg-[color:rgba(0,255,136,0.08)] text-[color:rgba(0,255,136,0.92)]"
      : tone === "bad"
        ? "border-[color:rgba(255,80,80,0.22)] bg-[color:rgba(255,80,80,0.08)] text-[color:rgba(255,80,80,0.92)]"
        : "border-white/10 bg-white/5 text-white/75";
  return (
    <div className={"rounded-[18px] border p-5 " + cls}>
      <p className="font-mono text-[10px] tracking-[0.22em] opacity-80">JARVIS</p>
      <p className="mt-2 text-[14px] leading-[1.7]">{text}</p>
    </div>
  );
}

function ReviewMock() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[color:rgba(0,0,0,0.25)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 opacity-[0.75] [background:radial-gradient(700px_420px_at_20%_0%,rgba(0,212,255,0.14),transparent_55%)]" />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">WEEKLY REVIEW</p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-white/55">
            AUTO
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <MiniStat label="RULES" value="2 breaks" />
          <MiniStat label="EDGE" value="London" />
          <MiniStat label="PATTERN" value="Post-loss chase" />
          <MiniStat label="FOCUS" value="A+ only" />
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
          <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">NOTE</p>
          <p className="mt-2 text-[13px] leading-[1.7] text-white/75">
            "Your best week is when you stop after 2 losses. That's the rule."
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
      <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">{label}</p>
      <p className="mt-2 font-mono text-[12px] tracking-[0.12em] text-white/80">{value}</p>
    </div>
  );
}
