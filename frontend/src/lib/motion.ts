import { useReducedMotion } from "framer-motion";

/** Jarvis / HUD ease — matches main product feel */
export const easeOs = [0.22, 1, 0.36, 1] as const;

export function useOsMotion() {
  const reduce = useReducedMotion();
  return {
    reduce: !!reduce,
    /** Viewport reveal — instant when reduced motion */
    viewTransition(overrides?: { duration?: number; delay?: number }) {
      if (reduce) return { duration: 0.01, delay: overrides?.delay ?? 0, ease: easeOs };
      return { duration: 0.65, delay: 0, ease: easeOs, ...overrides };
    },
    /** Stagger-friendly base duration */
    stagger(overrides?: { duration?: number }) {
      if (reduce) return { duration: 0.01, ...overrides };
      return { duration: 0.55, ease: easeOs, ...overrides };
    },
  };
}
