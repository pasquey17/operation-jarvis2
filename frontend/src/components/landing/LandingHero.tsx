import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "../../ui/Button";
import { easeOs, useOsMotion } from "../../lib/motion";

export function LandingHero() {
  const { reduce, stagger } = useOsMotion();
  const words = ["Your", "edge,", "under", "control."];
  return (
    <div className="mx-auto w-full max-w-[980px] text-center">
      <motion.p
        initial={reduce ? false : { opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={stagger({ duration: 0.5 })}
        className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--muted)]"
      >
        AI TRADING OPERATING SYSTEM
      </motion.p>

      <h1 className="mt-5 text-balance text-4xl font-semibold leading-[0.98] tracking-[-0.04em] text-[color:var(--text)] sm:text-5xl md:text-7xl">
        {words.map((word, i) => (
          <motion.span
            key={word + i}
            initial={reduce ? false : { opacity: 0, y: 14, filter: "blur(3px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true }}
            transition={{ duration: reduce ? 0.01 : 0.52, delay: reduce ? 0 : i * 0.07, ease: easeOs }}
            className="inline-block mr-[0.2em]"
          >
            {word}
          </motion.span>
        ))}
      </h1>

      <motion.p
        initial={reduce ? false : { opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.55, delay: reduce ? 0 : 0.32, ease: easeOs }}
        className="mx-auto mt-6 max-w-[52ch] text-pretty text-[15px] leading-[1.85] text-[color:var(--muted)] md:text-[16px]"
      >
        Jarvis connects your journal, analytics, and coaching so patterns surface before they
        become expensive — with memory that is dated, specific, and yours.
      </motion.p>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: reduce ? 0 : 0.45, ease: easeOs }}
        className="mt-9 flex min-h-[48px] flex-col items-center justify-center gap-3 sm:flex-row"
      >
        <Button as="a" href="/app/onboarding/" variant="primary">
          START CALIBRATION
        </Button>
        <Button as="a" href="/app/pricing/" variant="secondary">
          VIEW PRICING
        </Button>
      </motion.div>

      <motion.ul
        initial={reduce ? false : { opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: reduce ? 0 : 0.55, ease: easeOs }}
        className="mt-10 flex flex-wrap items-center justify-center gap-3 text-left sm:gap-4"
        aria-label="Trust signals"
      >
        <TrustChip>Private beta — invite-first</TrustChip>
        <TrustChip>Your data keys to you</TrustChip>
        <TrustChip>Built for execution, not signals</TrustChip>
      </motion.ul>
    </div>
  );
}

function TrustChip({ children }: { children: ReactNode }) {
  return (
    <li className="rounded-full border border-[color:var(--border)] bg-black/25 px-4 py-2.5 font-mono text-[9px] tracking-[0.16em] text-[color:var(--faint)] backdrop-blur-md sm:text-[10px]">
      {children}
    </li>
  );
}
