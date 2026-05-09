import type { PropsWithChildren } from "react";
import { motion } from "framer-motion";
import { Button } from "./Button";

type ActiveKey = "app" | "pricing" | "onboarding" | "dashboard";

export function AppShell({
  active,
  minimalNav,
  children,
}: PropsWithChildren<{ active: ActiveKey; minimalNav?: boolean }>) {
  return (
    <div className="min-h-dvh">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 opacity-[0.65] [background:radial-gradient(800px_500px_at_20%_0%,rgba(0,212,255,0.18),transparent_60%),radial-gradient(700px_520px_at_85%_10%,rgba(132,92,255,0.16),transparent_60%)]" />
        <div className="absolute inset-0 opacity-[0.22] [background:linear-gradient(180deg,rgba(255,255,255,0.06),transparent_38%)]" />
      </div>

      {!minimalNav && (
        <header className="sticky top-0 z-50 border-b border-white/10 bg-black/40 backdrop-blur-xl">
          <div className="mx-auto flex w-[min(1100px,calc(100%-32px))] items-center justify-between py-4">
            <a
              href="/app/"
              className="font-mono text-xs tracking-[0.34em] text-[color:var(--blue)]"
            >
              JARVIS
            </a>
            <nav className="hidden items-center gap-8 font-mono text-[11px] tracking-[0.18em] text-white/55 md:flex">
              <a
                className={linkClass(active === "app")}
                href="/app/"
              >
                OVERVIEW
              </a>
              <a
                className={linkClass(active === "pricing")}
                href="/app/pricing/"
              >
                PRICING
              </a>
              <a
                className={linkClass(active === "onboarding")}
                href="/app/onboarding/"
              >
                ONBOARD
              </a>
              <a
                className={linkClass(active === "dashboard")}
                href="/app/dashboard/"
              >
                DASH
              </a>
            </nav>
            <div className="flex items-center gap-2">
              <Button as="a" href="/index.html" size="sm" variant="secondary">
                BACK TO CLASSIC
              </Button>
              <Button as="a" href="/app/onboarding/" size="sm" variant="primary">
                START
              </Button>
            </div>
          </div>
        </header>
      )}

      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto w-[min(1100px,calc(100%-32px))] py-10 md:py-14"
      >
        {children}
      </motion.main>
    </div>
  );
}

function linkClass(active: boolean) {
  return (
    "transition hover:text-white/80 " +
    (active ? "text-[color:var(--blue)]" : "text-white/55")
  );
}

