import { motion } from "framer-motion";
import { easeOs, useOsMotion } from "../../lib/motion";
import { OsMock } from "./LandingMocks";

export function LandingStory() {
  const { reduce } = useOsMotion();
  return (
    <div className="mx-auto grid w-full max-w-[1100px] items-center gap-10 md:grid-cols-[0.95fr_1.05fr]">
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">SYSTEM</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.03em] text-[color:var(--text)] md:text-5xl">
          Not a dashboard.
          <br />
          An operating system.
        </h2>
        <p className="mt-4 max-w-[54ch] text-[14px] leading-[1.85] text-[color:var(--muted)]">
          Journal, analytics, and coaching share one memory graph. When something drifts, the
          OS names it with dates, pairs, and setups — not motivational fog.
        </p>
        <ul className="mt-6 flex list-none flex-wrap gap-2 p-0">
          {["JOURNAL", "MEMORY", "COACHING", "ANALYTICS"].map((t) => (
            <li
              key={t}
              className="rounded-full border border-[color:var(--border)] bg-white/[0.04] px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-[color:var(--muted)]"
            >
              {t}
            </li>
          ))}
        </ul>
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.97, y: 14 }}
        whileInView={{ opacity: 1, scale: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.65, ease: easeOs }}
      >
        <OsMock />
      </motion.div>
    </div>
  );
}
