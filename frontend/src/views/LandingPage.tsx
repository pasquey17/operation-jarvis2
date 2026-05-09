import { useMemo, useRef } from "react";
import {
  motion,
  MotionConfig,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { Button } from "../ui/Button";

export function LandingPage() {
  const prefersReducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: rootRef,
    offset: ["start start", "end end"],
  });

  // progress segments
  const ease = [0.22, 1, 0.36, 1] as const;
  const pHero = useTransform(scrollYProgress, [0.0, 0.18], [0, 1]);
  const pProblem = useTransform(scrollYProgress, [0.15, 0.35], [0, 1]);
  const pSystem = useTransform(scrollYProgress, [0.32, 0.52], [0, 1]);
  const pMemory = useTransform(scrollYProgress, [0.50, 0.68], [0, 1]);
  const pCoaching = useTransform(scrollYProgress, [0.66, 0.82], [0, 1]);
  const pReview = useTransform(scrollYProgress, [0.80, 0.94], [0, 1]);
  const pCta = useTransform(scrollYProgress, [0.92, 1.0], [0, 1]);

  const heroScale = useTransform(pHero, [0, 1], [1.06, 1]);
  const heroBlur = useTransform(pHero, [0, 1], [14, 0]);
  const heroOpacity = useTransform(pHero, [0, 1], [0.0, 1.0]);

  const bgShift = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const vignette = useTransform(scrollYProgress, [0, 1], [0.15, 0.35]);

  const sceneHeights = useMemo(
    () => ({
      total: prefersReducedMotion ? "260vh" : "520vh",
      sticky: prefersReducedMotion ? "calc(100dvh - 72px)" : "100dvh",
    }),
    [prefersReducedMotion]
  );

  return (
    <MotionConfig transition={{ duration: 0.65, ease }}>
      <div ref={rootRef} style={{ height: sceneHeights.total }}>
        <div
          className="sticky top-[64px] md:top-[72px] overflow-hidden rounded-[24px] border border-white/10 bg-[color:rgba(0,0,0,0.20)] shadow-[0_22px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
          style={{ height: sceneHeights.sticky }}
        >
          {/* Ambient background layers */}
          <motion.div
            style={{ y: prefersReducedMotion ? 0 : bgShift }}
            className="pointer-events-none absolute inset-0 opacity-[0.95]"
          >
            <div className="absolute inset-0 [background:radial-gradient(1100px_700px_at_18%_-10%,rgba(0,212,255,0.22),transparent_58%),radial-gradient(900px_620px_at_88%_10%,rgba(140,120,255,0.18),transparent_62%)]" />
            <div className="absolute inset-0 opacity-[0.45] [background:linear-gradient(180deg,rgba(255,255,255,0.06),transparent_36%)]" />
          </motion.div>

          <motion.div
            style={{
              opacity: vignette,
            }}
            className="pointer-events-none absolute inset-0 [background:radial-gradient(900px_560px_at_50%_30%,transparent_40%,rgba(0,0,0,0.85)_100%)]"
          />

          {/* Scene stack */}
          <div className="relative h-full">
            <SceneHero
              opacity={heroOpacity}
              scale={prefersReducedMotion ? 1 : heroScale}
              blurPx={prefersReducedMotion ? 0 : heroBlur}
            />

            <SceneProblem progress={pProblem} />
            <SceneSystem progress={pSystem} />
            <SceneMemory progress={pMemory} />
            <SceneCoaching progress={pCoaching} />
            <SceneReview progress={pReview} />
            <SceneCTA progress={pCta} />
          </div>
        </div>

        {/* Scroll hint */}
        <div className="pointer-events-none mt-10 text-center font-mono text-[10px] tracking-[0.24em] text-white/35">
          SCROLL TO REVEAL
        </div>
      </div>
    </MotionConfig>
  );
}

function SceneHero({
  opacity,
  scale,
  blurPx,
}: {
  opacity: any;
  scale: any;
  blurPx: any;
}) {
  const blurFilter = useTransform(blurPx, (v) => `blur(${v}px)`);
  return (
    <motion.section
      style={{
        opacity,
        scale,
        filter: blurFilter,
      }}
      className="absolute inset-0 grid place-items-center px-6"
    >
      <div className="w-full max-w-[980px] text-center">
        <p className="font-mono text-[10px] tracking-[0.28em] text-white/55">
          AI TRADING OPERATING SYSTEM
        </p>
        <h1 className="mt-5 text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.04em] text-white md:text-7xl">
          Your edge deserves{" "}
          <span className="text-white/90">consistency</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-[52ch] text-pretty text-[15px] leading-[1.8] text-white/70 md:text-[16px]">
          Jarvis is a living system that learns your patterns and protects you
          from self-sabotage — with dated, instrument-specific memory.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button as="a" href="/app/onboarding/" variant="primary">
            START CALIBRATION
          </Button>
          <Button as="a" href="/app/pricing/" variant="secondary">
            VIEW PRICING
          </Button>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <HeroChip label="MEMORY" value="DATED" />
          <HeroChip label="COACHING" value="LIVE" />
          <HeroChip label="EXECUTION" value="PROTECTED" />
        </div>
      </div>
    </motion.section>
  );
}

function SceneProblem({ progress }: { progress: any }) {
  const y = useTransform(progress, [0, 1], [28, 0]);
  const opacity = useTransform(progress, [0, 0.25, 1], [0, 1, 1]);
  const blur = useTransform(progress, [0, 1], [16, 0]);
  const blurFilter = useTransform(blur, (v) => `blur(${v}px)`);
  return (
    <motion.section
      style={{
        opacity,
        y,
        filter: blurFilter,
      }}
      className="absolute inset-0 grid place-items-center px-6"
    >
      <div className="w-full max-w-[980px]">
        <div className="grid gap-6 md:grid-cols-2 md:items-center">
          <div>
            <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">
              PROBLEM
            </p>
            <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
              It’s not your strategy.
              <br />
              It’s your state.
            </h2>
            <p className="mt-4 max-w-[52ch] text-[14px] leading-[1.8] text-white/68">
              Traders don’t fail from a lack of information. They fail from
              inconsistency, emotional drift, and repeating the same pattern
              without naming it.
            </p>
          </div>
          <div className="space-y-3">
            <ProblemCard title="After a loss" line="Impulse entries masquerade as “revenge.”" />
            <ProblemCard title="After a win" line="Overconfidence widens the rules quietly." />
            <ProblemCard title="Under pressure" line="You abandon process to chase outcome." />
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function SceneSystem({ progress }: { progress: any }) {
  const opacity = useTransform(progress, [0, 0.2, 1], [0, 1, 1]);
  const y = useTransform(progress, [0, 1], [24, 0]);
  const panelScale = useTransform(progress, [0, 1], [0.98, 1]);
  return (
    <motion.section style={{ opacity, y }} className="absolute inset-0 px-6 py-10">
      <div className="mx-auto grid h-full w-full max-w-[1100px] items-center gap-8 md:grid-cols-[0.95fr_1.05fr]">
        <div>
          <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">
            SYSTEM INTRO
          </p>
          <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
            This isn’t a dashboard.
            <br />
            It’s an operating system.
          </h2>
          <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.8] text-white/68">
            Journal, analytics, and coaching aren’t separate tools. Jarvis
            connects them so your patterns become obvious — and actionable.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Pill>JOURNAL</Pill>
            <Pill>MEMORY</Pill>
            <Pill>COACHING</Pill>
            <Pill>REVIEWS</Pill>
          </div>
        </div>
        <motion.div style={{ scale: panelScale }} className="relative">
          <OsMock />
        </motion.div>
      </div>
    </motion.section>
  );
}

function SceneMemory({ progress }: { progress: any }) {
  const opacity = useTransform(progress, [0, 0.18, 1], [0, 1, 1]);
  const y = useTransform(progress, [0, 1], [22, 0]);
  const leftX = useTransform(progress, [0, 1], [-18, 0]);
  const rightX = useTransform(progress, [0, 1], [18, 0]);
  return (
    <motion.section style={{ opacity, y }} className="absolute inset-0 px-6 py-10">
      <div className="mx-auto grid h-full w-full max-w-[1100px] items-center gap-8 md:grid-cols-2">
        <motion.div style={{ x: leftX }}>
          <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">
            MEMORY MOMENT
          </p>
          <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
            Jarvis remembers the moment you drift.
          </h2>
          <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.8] text-white/68">
            Not vague labels. Not “you overtrade.” Real anchors: dates, pairs,
            setups — so you can spot the loop before it repeats.
          </p>
        </motion.div>
        <motion.div style={{ x: rightX }} className="space-y-3">
          <MemoryLine
            label="RECENT PATTERN"
            text="Revenge traded on XAUUSD after two consecutive losses on 14 April (London)."
          />
          <MemoryLine
            label="SETUP DRIFT"
            text="Skipped your A+ model twice on 21 April, then forced an entry late session."
          />
          <MemoryLine
            label="RISK SIGNAL"
            text="When RR dips below 1.0, you start hunting instead of waiting."
          />
        </motion.div>
      </div>
    </motion.section>
  );
}

function SceneCoaching({ progress }: { progress: any }) {
  const opacity = useTransform(progress, [0, 0.18, 1], [0, 1, 1]);
  const y = useTransform(progress, [0, 1], [22, 0]);
  const hud = useTransform(progress, [0, 1], [0.96, 1]);
  return (
    <motion.section style={{ opacity, y }} className="absolute inset-0 px-6 py-10">
      <div className="mx-auto grid h-full w-full max-w-[1100px] items-center gap-8 md:grid-cols-[1.05fr_0.95fr]">
        <motion.div style={{ scale: hud }}>
          <CoachingOverlay />
        </motion.div>
        <div>
          <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">
            LIVE COACHING
          </p>
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
    </motion.section>
  );
}

function SceneReview({ progress }: { progress: any }) {
  const opacity = useTransform(progress, [0, 0.18, 1], [0, 1, 1]);
  const y = useTransform(progress, [0, 1], [22, 0]);
  return (
    <motion.section style={{ opacity, y }} className="absolute inset-0 px-6 py-10">
      <div className="mx-auto grid h-full w-full max-w-[1100px] items-center gap-8 md:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">
            WEEKLY REVIEW
          </p>
          <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-5xl">
            The week gets compressed into clarity.
          </h2>
          <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.8] text-white/68">
            Automation that surfaces the truth: rule breaks, session edge, and
            the psychological triggers that cost you.
          </p>
        </div>
        <ReviewMock />
      </div>
    </motion.section>
  );
}

function SceneCTA({ progress }: { progress: any }) {
  const opacity = useTransform(progress, [0, 0.25, 1], [0, 1, 1]);
  const y = useTransform(progress, [0, 1], [26, 0]);
  const scale = useTransform(progress, [0, 1], [0.98, 1]);
  return (
    <motion.section
      style={{ opacity, y, scale }}
      className="absolute inset-0 grid place-items-center px-6"
    >
      <div className="w-full max-w-[980px] text-center">
        <p className="font-mono text-[10px] tracking-[0.28em] text-white/45">
          FINAL CTA
        </p>
        <h2 className="mt-5 text-balance text-4xl font-semibold leading-[1.03] tracking-[-0.04em] text-white md:text-6xl">
          Stop repeating the same month.
          <br />
          Install your system.
        </h2>
        <p className="mx-auto mt-6 max-w-[56ch] text-pretty text-[14px] leading-[1.85] text-white/68 md:text-[15px]">
          Jarvis is built to keep you grounded and consistent — with memory that
          feels like it’s been watching you for months.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button as="a" href="/app/onboarding/" variant="primary">
            START CALIBRATION
          </Button>
          <Button as="a" href="/app/pricing/" variant="secondary">
            SEE PRICING
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-2xl">
      <p className="font-mono text-[10px] tracking-[0.22em] text-white/45">
        {label}
      </p>
      <p className="mt-2 font-mono text-[12px] tracking-[0.18em] text-white/80">
        {value}
      </p>
    </div>
  );
}

function ProblemCard({ title, line }: { title: string; line: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
      <p className="font-mono text-[10px] tracking-[0.22em] text-white/45">
        {title.toUpperCase()}
      </p>
      <p className="mt-2 text-[14px] leading-[1.7] text-white/75">{line}</p>
    </div>
  );
}

function MemoryLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
      <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.82)]">
        {label}
      </p>
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
    <span
      className={
        "rounded-full border px-3 py-2 font-mono text-[10px] tracking-[0.18em] " +
        cls
      }
    >
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
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">
            JARVIS OS
          </p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-white/55">
            LIVE
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
            <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">
              DAILY FOCUS
            </p>
            <p className="mt-2 text-[14px] leading-[1.65] text-white/78">
              One clean setup. No impulse entries after a loss.
            </p>
          </div>
          <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
            <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">
              SESSION TIMER
            </p>
            <p className="mt-2 font-mono text-[18px] tracking-[0.08em] text-white/85">
              LONDON · 00:18:42
            </p>
          </div>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
          <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">
            MEMORY
          </p>
          <p className="mt-2 text-[13px] leading-[1.7] text-white/75">
            “On 14 April you forced XAUUSD after a loss. This is that moment.”
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
        <OverlayMsg tone="bad" text="Stand down. This isn’t your model." />
        <OverlayMsg tone="neutral" text="Breathe. Find the A+ criteria again." />
        <OverlayMsg tone="good" text="This matches your edge. Execute clean." />
      </div>
    </div>
  );
}

function OverlayMsg({
  tone,
  text,
}: {
  tone: "good" | "bad" | "neutral";
  text: string;
}) {
  const cls =
    tone === "good"
      ? "border-[color:rgba(0,255,136,0.22)] bg-[color:rgba(0,255,136,0.08)] text-[color:rgba(0,255,136,0.92)]"
      : tone === "bad"
        ? "border-[color:rgba(255,80,80,0.22)] bg-[color:rgba(255,80,80,0.08)] text-[color:rgba(255,80,80,0.92)]"
        : "border-white/10 bg-white/5 text-white/75";
  return (
    <div className={"rounded-[18px] border p-5 " + cls}>
      <p className="font-mono text-[10px] tracking-[0.22em] opacity-80">
        JARVIS
      </p>
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
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">
            WEEKLY REVIEW
          </p>
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
          <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">
            NOTE
          </p>
          <p className="mt-2 text-[13px] leading-[1.7] text-white/75">
            “Your best week is when you stop after 2 losses. That’s the rule.”
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-5">
      <p className="font-mono text-[10px] tracking-[0.18em] text-white/40">
        {label}
      </p>
      <p className="mt-2 font-mono text-[12px] tracking-[0.12em] text-white/80">
        {value}
      </p>
    </div>
  );
}

