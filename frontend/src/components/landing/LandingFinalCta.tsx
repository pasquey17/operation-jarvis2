import { motion } from "framer-motion";
import { Button } from "../../ui/Button";
import { useOsMotion } from "../../lib/motion";

export function LandingFinalCta() {
  const { reduce, stagger } = useOsMotion();
  return (
    <div className="mx-auto w-full max-w-[900px] text-center">
      <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">READY</p>
      <h2 className="mt-5 text-balance text-3xl font-semibold leading-[1.05] tracking-[-0.04em] text-[color:var(--text)] md:text-6xl">
        Stop repeating the same month.
        <br />
        Install your system.
      </h2>
      <p className="mx-auto mt-6 max-w-[56ch] text-pretty text-[14px] leading-[1.85] text-[color:var(--muted)] md:text-[15px]">
        Calibration takes minutes. The payoff is months of cleaner execution — because the OS
        finally remembers what you refuse to forget.
      </p>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={stagger({ duration: 0.5 })}
        className="mt-9 flex min-h-[48px] flex-col items-center justify-center gap-3 sm:flex-row"
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
