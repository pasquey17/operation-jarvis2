import { motion } from "framer-motion";
import { easeOs, useOsMotion } from "../../lib/motion";

export function LandingProblem() {
  const { reduce } = useOsMotion();
  const items = [
    { title: "After a loss", line: "Impulse entries disguise themselves as “just one more.”" },
    { title: "After a win", line: "Rules widen quietly while confidence runs hot." },
    { title: "Under pressure", line: "Process bends to outcome — and the loop tightens." },
  ];
  return (
    <div className="mx-auto grid w-full max-w-[980px] gap-8 md:grid-cols-2 md:items-center">
      <motion.div
        initial={reduce ? false : { opacity: 0, x: -18 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: easeOs }}
      >
        <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">PROBLEM</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.03em] text-[color:var(--text)] md:text-5xl">
          It is rarely the model.
          <br />
          It is the state.
        </h2>
        <p className="mt-4 max-w-[52ch] text-[14px] leading-[1.85] text-[color:var(--muted)]">
          Traders do not lose from missing information. They lose from unnamed repetition —
          the same drift, different week — until the ledger says it out loud.
        </p>
      </motion.div>
      <ul className="space-y-3">
        {items.map((item, i) => (
          <motion.li
            key={item.title}
            initial={reduce ? false : { opacity: 0, x: 18 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: reduce ? 0 : i * 0.1, ease: easeOs }}
          >
            <article className="rounded-[18px] border border-[color:var(--border)] bg-black/25 p-5 backdrop-blur-md">
              <h3 className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--faint)]">
                {item.title.toUpperCase()}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.75] text-[color:var(--muted)]">{item.line}</p>
            </article>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
