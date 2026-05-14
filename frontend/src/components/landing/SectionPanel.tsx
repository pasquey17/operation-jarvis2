import type { PropsWithChildren } from "react";
import { motion } from "framer-motion";
import { easeOs, useOsMotion } from "../../lib/motion";

const panelFrame =
  "relative overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[color:var(--panel2)] shadow-[0_22px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl";

export function SectionPanel({
  id,
  children,
  delay = 0,
}: PropsWithChildren<{ id?: string; delay?: number }>) {
  const { reduce, viewTransition } = useOsMotion();
  return (
    <motion.section
      id={id}
      initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-72px" }}
      transition={{ ...viewTransition({ delay }), ease: easeOs }}
      className={panelFrame}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.9] [background:radial-gradient(1000px_640px_at_14%_-8%,rgba(0,212,255,0.16),transparent_55%),radial-gradient(820px_520px_at_92%_8%,rgba(100,80,200,0.12),transparent_58%)]" />
        <div className="absolute inset-0 opacity-[0.35] [background:linear-gradient(180deg,rgba(255,255,255,0.05),transparent_38%)]" />
      </div>
      {/* HUD corner ticks — very subtle */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-3 h-5 w-5 border-l border-t border-[color:rgba(0,212,255,0.2)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-3 h-5 w-5 border-r border-t border-[color:rgba(0,212,255,0.2)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 border-b border-l border-[color:rgba(0,212,255,0.14)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 right-3 h-5 w-5 border-b border-r border-[color:rgba(0,212,255,0.14)]"
      />
      <div className="relative px-6 py-14 md:px-10 md:py-16">{children}</div>
    </motion.section>
  );
}
