import type { PropsWithChildren } from "react";
import { useReducedMotion } from "framer-motion";
import { motion } from "framer-motion";
import { Button } from "./Button";
import { JarvisBackdrop } from "../components/landing/JarvisBackdrop";
import { easeOs } from "../lib/motion";

type ActiveKey = "app" | "pricing" | "onboarding" | "dashboard";

const navLink =
  "shrink-0 rounded-md px-2 py-2 font-mono text-[10px] tracking-[0.16em] text-white/55 transition hover:text-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(0,212,255,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a] sm:text-[11px] sm:tracking-[0.18em]";

export function AppShell({
  active,
  minimalNav,
  children,
}: PropsWithChildren<{ active: ActiveKey; minimalNav?: boolean }>) {
  const reduce = useReducedMotion();
  return (
    <div className="min-h-dvh font-sans">
      <JarvisBackdrop />

      {!minimalNav && (
        <header className="sticky top-0 z-50 border-b border-[color:var(--border)] bg-[color:rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div className="mx-auto flex w-[min(1100px,calc(100%-32px))] items-center gap-3 py-3 sm:py-4">
            <a
              href="/app/"
              className="shrink-0 font-mono text-[11px] tracking-[0.34em] text-[color:var(--blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(0,212,255,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a] sm:text-xs"
            >
              JARVIS
            </a>
            <nav
              aria-label="Marketing sections"
              className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-6 md:justify-center [&::-webkit-scrollbar]:hidden"
            >
              <a
                className={navLink + (active === "app" ? " text-[color:var(--blue)]" : "")}
                href="/app/"
                aria-current={active === "app" ? "page" : undefined}
              >
                OVERVIEW
              </a>
              <a
                className={navLink + (active === "pricing" ? " text-[color:var(--blue)]" : "")}
                href="/app/pricing/"
                aria-current={active === "pricing" ? "page" : undefined}
              >
                PRICING
              </a>
              <a
                className={navLink + (active === "onboarding" ? " text-[color:var(--blue)]" : "")}
                href="/app/onboarding/"
                aria-current={active === "onboarding" ? "page" : undefined}
              >
                ONBOARD
              </a>
              <a
                className={navLink + (active === "dashboard" ? " text-[color:var(--blue)]" : "")}
                href="/app/dashboard/"
                aria-current={active === "dashboard" ? "page" : undefined}
              >
                DASH
              </a>
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <Button as="a" href="/index.html" size="sm" variant="secondary">
                CLASSIC
              </Button>
              <Button as="a" href="/app/onboarding/" size="sm" variant="primary">
                START
              </Button>
            </div>
          </div>
        </header>
      )}

      <motion.main
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0.01 : 0.55, ease: easeOs }}
        className="mx-auto w-[min(1100px,calc(100%-32px))] py-10 md:py-14"
      >
        {children}
      </motion.main>
    </div>
  );
}
