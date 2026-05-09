import type { PropsWithChildren } from "react";
import { motion } from "framer-motion";

export function Card({
  eyebrow,
  meta,
  hover = true,
  children,
}: PropsWithChildren<{
  eyebrow?: string;
  meta?: string;
  hover?: boolean;
}>) {
  const Comp: any = hover ? motion.section : "section";
  const hoverProps = hover
    ? { whileHover: { y: -2 }, transition: { duration: 0.25 } }
    : {};

  return (
    <Comp
      {...hoverProps}
      className="relative overflow-hidden rounded-[22px] border border-white/10 bg-[color:var(--panel)] p-7 shadow-[0_18px_60px_rgba(0,0,0,0.52)] backdrop-blur-2xl"
    >
      <div className="pointer-events-none absolute inset-0 opacity-[0.55] [background:radial-gradient(760px_420px_at_20%_0%,rgba(0,212,255,0.12),transparent_60%)]" />
      <div className="relative">
        {(eyebrow || meta) && (
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.85)]">
              {eyebrow || ""}
            </p>
            {meta && (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-white/55">
                {meta}
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </Comp>
  );
}

