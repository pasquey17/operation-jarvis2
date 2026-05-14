import { motion } from "framer-motion";
import { easeOs, useOsMotion } from "../../lib/motion";

const memoryItems = [
  {
    label: "RECENT PATTERN",
    text: "Revenge traded on XAUUSD after two consecutive losses on 14 April (London).",
  },
  {
    label: "SETUP DRIFT",
    text: "Skipped your A+ model twice on 21 April, then forced an entry late session.",
  },
  {
    label: "RISK SIGNAL",
    text: "When RR dips below 1.0, you start hunting instead of waiting.",
  },
];

export function MemoryLines() {
  const { reduce } = useOsMotion();
  return (
    <ul className="list-none space-y-3 p-0">
      {memoryItems.map((item, i) => (
        <motion.li
          key={item.label}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: reduce ? 0 : i * 0.1, ease: easeOs }}
        >
          <article className="rounded-[18px] border border-[color:var(--border)] bg-black/25 p-5 backdrop-blur-md">
            <h3 className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.82)]">
              {item.label}
            </h3>
            <p className="mt-2 text-[14px] leading-[1.75] text-[color:var(--muted)]">{item.text}</p>
          </article>
        </motion.li>
      ))}
    </ul>
  );
}

export function OsMock() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-[color:var(--border)] bg-black/30 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 opacity-[0.85] [background:radial-gradient(700px_420px_at_20%_0%,rgba(0,212,255,0.14),transparent_55%)]" />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] tracking-[0.2em] text-[color:var(--faint)]">JARVIS OS</p>
          <span className="rounded-full border border-[color:rgba(0,212,255,0.28)] bg-[color:rgba(0,212,255,0.08)] px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(0,212,255,0.92)]">
            LIVE
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[18px] border border-[color:var(--border)] bg-black/25 p-5">
            <p className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--faint)]">DAILY FOCUS</p>
            <p className="mt-2 text-[14px] leading-[1.65] text-[color:var(--muted)]">
              One clean setup. No impulse entries after a loss.
            </p>
          </div>
          <div className="rounded-[18px] border border-[color:rgba(0,212,255,0.18)] bg-black/25 p-5">
            <p className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--faint)]">SESSION EDGE</p>
            <p className="mt-2 font-mono text-[18px] tracking-[0.08em] text-[color:rgba(0,212,255,0.9)]">LONDON</p>
          </div>
        </div>
        <div className="rounded-[18px] border border-[color:var(--border)] bg-black/25 p-5">
          <p className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--faint)]">MEMORY</p>
          <p className="mt-2 text-[13px] leading-[1.7] text-[color:var(--muted)]">
            “On 14 April you forced XAUUSD after a loss. This is that moment.”
          </p>
        </div>
      </div>
    </div>
  );
}

export function CoachingOverlay() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-[color:var(--border)] bg-black/30 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 opacity-[0.7] [background:radial-gradient(700px_420px_at_80%_20%,rgba(0,212,255,0.14),transparent_55%)]" />
      <div className="relative space-y-3">
        <OverlayMsg tone="bad" text="Stand down. This is not your model." />
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
        ? "border-[color:rgba(255,80,80,0.22)] bg-[color:rgba(255,80,80,0.08)] text-[color:rgba(255,100,100,0.92)]"
        : "border-[color:var(--border)] bg-white/[0.04] text-[color:var(--muted)]";
  return (
    <div className={"rounded-[18px] border p-5 " + cls}>
      <p className="font-mono text-[10px] tracking-[0.22em] opacity-80">JARVIS</p>
      <p className="mt-2 text-[14px] leading-[1.7]">{text}</p>
    </div>
  );
}

export function ReviewBlock() {
  const { reduce } = useOsMotion();
  return (
    <div className="mx-auto grid w-full max-w-[1100px] items-center gap-8 md:grid-cols-2">
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">WEEKLY REVIEW</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.03em] text-[color:var(--text)] md:text-5xl">
          The week compresses into clarity.
        </h2>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.85] text-[color:var(--muted)]">
          Surfaces rule breaks, session edge, and the psychological triggers that cost you —
          without turning it into a lecture.
        </p>
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.97 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: easeOs }}
      >
        <ReviewMock />
      </motion.div>
    </div>
  );
}

function ReviewMock() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-[color:var(--border)] bg-black/30 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 opacity-[0.75] [background:radial-gradient(700px_420px_at_20%_0%,rgba(0,212,255,0.14),transparent_55%)]" />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] tracking-[0.2em] text-[color:var(--faint)]">WEEKLY REVIEW</p>
          <span className="rounded-full border border-[color:var(--border)] bg-white/[0.04] px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-[color:var(--faint)]">
            AUTO
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <MiniStat label="RULES" value="2 breaks" />
          <MiniStat label="EDGE" value="London" />
          <MiniStat label="PATTERN" value="Post-loss chase" />
          <MiniStat label="FOCUS" value="A+ only" />
        </div>
        <div className="rounded-[18px] border border-[color:var(--border)] bg-black/25 p-5">
          <p className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--faint)]">NOTE</p>
          <p className="mt-2 text-[13px] leading-[1.7] text-[color:var(--muted)]">
            “Your best week is when you stop after two losses. That is the rule.”
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[color:var(--border)] bg-black/25 p-5">
      <p className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--faint)]">{label}</p>
      <p className="mt-2 font-mono text-[12px] tracking-[0.12em] text-[color:var(--text)]">{value}</p>
    </div>
  );
}
