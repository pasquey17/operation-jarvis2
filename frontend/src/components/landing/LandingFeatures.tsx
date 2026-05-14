import { motion } from "framer-motion";
import { easeOs, useOsMotion } from "../../lib/motion";
import { CoachingOverlay, MemoryLines } from "./LandingMocks";

export function LandingFeatures() {
  const { reduce } = useOsMotion();
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-14">
      <section aria-labelledby="heading-memory" className="grid gap-8 md:grid-cols-2 md:items-start">
        <div>
          <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">MEMORY</p>
          <h2
            id="heading-memory"
            className="mt-4 text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.03em] text-[color:var(--text)] md:text-5xl"
          >
            It remembers the exact drift.
          </h2>
          <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.85] text-[color:var(--muted)]">
            Anchors you can argue with: sessions, instruments, and the sequence that led to the
            break — so the next session starts honest.
          </p>
        </div>
        <MemoryLines />
      </section>

      <section aria-labelledby="heading-coach" className="grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-center">
        <motion.div
          initial={reduce ? false : { opacity: 0, x: -16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: easeOs }}
        >
          <CoachingOverlay />
        </motion.div>
        <div>
          <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">LIVE COACHING</p>
          <h2
            id="heading-coach"
            className="mt-4 text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.03em] text-[color:var(--text)] md:text-5xl"
          >
            Interrupt the next mistake.
          </h2>
          <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.85] text-[color:var(--muted)]">
            Fast, direct, calm. Jarvis stays inside your rules — no signals, no hype — when
            emotions try to rewrite the plan mid-session.
          </p>
          <ul className="mt-6 flex list-none flex-wrap gap-2 p-0">
            <li className="rounded-full border border-[color:rgba(0,255,136,0.22)] bg-[color:rgba(0,255,136,0.06)] px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(0,255,136,0.9)]">
              VALIDATE
            </li>
            <li className="rounded-full border border-[color:rgba(255,80,80,0.22)] bg-[color:rgba(255,80,80,0.06)] px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(255,100,100,0.9)]">
              WARN
            </li>
            <li className="rounded-full border border-[color:var(--border)] bg-white/[0.04] px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-[color:var(--muted)]">
              RESET
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
