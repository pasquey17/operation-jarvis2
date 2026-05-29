import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { apiFetch, supabase } from "../lib/jarvisAuth";
import { openNotionOAuthConnect } from "../lib/notionOAuth";

type OnboardingStep = "complete" | "mapping" | "profile" | "path-picker";

const ease = [0.22, 1, 0.36, 1] as const;

function redirect(href: string) {
  window.location.replace(href);
}

function OnboardingSpinner() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease }}
      className="flex min-h-[min(420px,50vh)] flex-col items-center justify-center gap-4 py-20"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <motion.div
        className="h-7 w-7 rounded-full border-2 border-[rgba(0,212,255,0.15)] border-t-[#00d4ff]"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
      />
      <p className="font-mono text-[10px] tracking-[0.22em] text-white/45">CHECKING STATUS</p>
    </motion.div>
  );
}

export function PathPickerPage() {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkState() {
      try {
        const res = await apiFetch("/api/user/onboarding-state");
        const data = (await res.json().catch(() => ({}))) as { step?: OnboardingStep; error?: string };

        if (cancelled) return;

        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : `Status check failed (${res.status})`);
          setPhase("error");
          return;
        }

        const step = data.step ?? "path-picker";

        switch (step) {
          case "complete":
            redirect("/index.html");
            return;
          case "mapping":
            redirect("/notion-setup.html?onboarding=true");
            return;
          case "profile":
            redirect("/app/onboarding/?step=profile");
            return;
          case "path-picker":
          default:
            setPhase("ready");
            return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load onboarding state.");
        setPhase("error");
      }
    }

    void checkState();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "loading") {
    return <OnboardingSpinner />;
  }

  if (phase === "error") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease }}
        className="mx-auto max-w-lg text-center"
      >
        <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(255,80,80,0.9)]">ERROR</p>
        <p className="mt-3 text-[14px] leading-[1.6] text-white/70">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 inline-flex items-center justify-center rounded-[14px] border border-[rgba(0,212,255,0.32)] bg-[rgba(0,212,255,0.12)] px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-[#00d4ff] transition hover:border-[rgba(0,212,255,0.55)] hover:bg-[rgba(0,212,255,0.18)]"
        >
          RETRY
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease }}
      className="mx-auto w-[min(980px,100%)]"
    >
      <header className="mb-10 text-center md:mb-12">
        <p className="font-mono text-[10px] tracking-[0.22em] text-[#00d4ff]">ONBOARDING</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-white md:text-5xl">
          How do you journal your trades?
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-[14px] leading-[1.7] text-white/65 md:text-[15px]">
          Jarvis connects directly to your trading journal to start learning your patterns.
        </p>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease }}
        className="grid gap-6 md:grid-cols-3"
      >
        <PathCard
          title="I journal in Notion"
          body="Connect your existing Notion database. Jarvis reads your trade history and starts building your intelligence profile."
          notice="📌 When Notion asks which pages to share, select your entire trading workspace — not just your trades table. Jarvis needs access to linked databases (pairs, sessions, models) to resolve your data correctly."
          actionLabel="Connect Notion →"
          variant="primary"
          onAction={async () => {
            const { data } = await supabase.auth.getSession();
            const userId = data.session?.user?.id;
            if (!userId) {
              setError("Couldn't authenticate. Please refresh and try again.");
              setPhase("error");
              return;
            }
            openNotionOAuthConnect(userId);
          }}
        />
        <PathCard
          title="I'll journal here"
          body="Use Jarvis's built-in journal. Log trades directly in the app and Jarvis learns as you go."
          actionLabel="Get started →"
          variant="outline"
          onAction={() => {
            window.location.href = "/app/onboarding/?step=profile";
          }}
        />
        <PathCard
          title="I have a CSV export"
          body="Already tracking trades elsewhere? Import your history as a one-time upload and Jarvis will start learning from it."
          actionLabel="Import CSV →"
          variant="outline"
          onAction={() => {
            window.location.href = "/csv-import.html";
          }}
        />
      </motion.div>
    </motion.div>
  );
}

function PathCard({
  title,
  body,
  notice,
  actionLabel,
  variant,
  onAction,
}: {
  title: string;
  body: string;
  notice?: string;
  actionLabel: string;
  variant: "primary" | "outline";
  onAction: () => void;
}) {
  const isPrimary = variant === "primary";

  return (
    <article className="relative flex flex-col overflow-hidden rounded-[22px] border border-[rgba(0,212,255,0.18)] bg-[#050a14] p-7 shadow-[0_0_40px_rgba(0,191,255,0.06)] backdrop-blur-xl md:p-8">
      <div className="pointer-events-none absolute inset-0 rounded-[22px] opacity-40 [background:radial-gradient(480px_280px_at_20%_0%,rgba(0,212,255,0.1),transparent_65%)]" />
      <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.22, ease }} className="relative z-[1] flex flex-1 flex-col">
        <h2 className="text-xl font-semibold tracking-[-0.02em] text-white md:text-2xl">{title}</h2>
        <p className="mt-3 flex-1 text-[14px] leading-[1.65] text-white/62">{body}</p>
        {notice && (
          <div className="mt-4 rounded-[10px] border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.07)] px-3.5 py-3 text-[12px] leading-[1.6] text-[rgba(255,255,255,0.78)]">
            {notice}
          </div>
        )}
        <button
          type="button"
          onClick={onAction}
          className={
            "mt-6 w-full rounded-[14px] px-5 py-3 font-mono text-[11px] tracking-[0.18em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,212,255,0.5)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050a14] " +
            (isPrimary
              ? "border border-[#00d4ff] bg-[#00d4ff] text-[#050a14] hover:bg-[#33ddff] hover:border-[#33ddff] shadow-[0_0_24px_rgba(0,212,255,0.25)]"
              : "border border-[#00d4ff] bg-transparent text-[#00d4ff] hover:bg-[rgba(0,212,255,0.08)]")
          }
        >
          {actionLabel}
        </button>
      </motion.div>
    </article>
  );
}
