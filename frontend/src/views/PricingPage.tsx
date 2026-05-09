import { useMemo, useState } from "react";
import { motion } from "framer-motion";

export function PricingPage() {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const price = useMemo(() => {
    const mul = billing === "yearly" ? 0.85 : 1;
    return {
      starter: Math.round(19 * mul),
      pro: Math.round(49 * mul),
      elite: Math.round(99 * mul),
    };
  }, [billing]);

  return (
    <div className="space-y-12">
      <header className="space-y-4">
        <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">
          PRICING
        </p>
        <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-6xl">
          Choose the Jarvis tier that matches your seriousness.
        </h1>
        <p className="max-w-2xl text-pretty text-[15px] leading-[1.7] text-white/70 md:text-[16px]">
          This is not a generic journal. It’s a discipline and execution system
          that remembers your patterns — and calls you out with specifics.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={() => setBilling("monthly")}
            className={toggleClass(billing === "monthly")}
            type="button"
          >
            MONTHLY
          </button>
          <button
            onClick={() => setBilling("yearly")}
            className={toggleClass(billing === "yearly")}
            type="button"
          >
            YEARLY <span className="ml-2 text-[color:rgba(0,255,136,0.85)]">-15%</span>
          </button>
          <span className="font-mono text-[10px] tracking-[0.18em] text-white/35">
            No backend changes required.
          </span>
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-3">
        <PlanCard
          name="Starter"
          price={price.starter}
          billing={billing}
          tone="neutral"
          items={[
            "Trade logging + notes",
            "Psychology tracking prompts",
            "Weekly review summaries",
            "Baseline analytics",
          ]}
        />
        <PlanCard
          name="Pro"
          price={price.pro}
          billing={billing}
          tone="primary"
          badge="Most popular"
          items={[
            "Full AI coaching chat",
            "Memory system (dated examples)",
            "Advanced analytics + trends",
            "Proactive reminders + focus",
          ]}
        />
        <PlanCard
          name="Elite"
          price={price.elite}
          billing={billing}
          tone="neutral"
          items={[
            "Complete Jarvis OS layer",
            "Deep personalization",
            "Elite reviews + rules audit",
            "Future premium tools",
          ]}
        />
      </section>

      <section className="overflow-hidden rounded-[22px] border border-white/10 bg-[color:var(--panel)] p-8 backdrop-blur-2xl md:p-10">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.85)]">
              FAQ
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-white">
              Straight answers.
            </h2>
            <p className="mt-3 text-[14px] leading-[1.7] text-white/70">
              Jarvis is private tooling. No hype. No generic coaching.
            </p>
          </div>
          <div className="space-y-3">
            <Faq q="Is this a signal service?" a="No. Jarvis is an execution + discipline system built around your own history." />
            <Faq q="Do I need to migrate data?" a="No. The new UI reads from the existing APIs and keeps everything intact." />
            <Faq q="Can I use it on mobile?" a="Yes. The new `/app/*` layer is designed mobile-first." />
          </div>
        </div>
      </section>

      <section className="flex flex-col items-start justify-between gap-6 rounded-[22px] border border-[color:rgba(0,212,255,0.16)] bg-[color:rgba(0,212,255,0.06)] p-8 backdrop-blur-2xl md:flex-row md:items-center md:p-10">
        <div>
          <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.85)]">
            READY
          </p>
          <p className="mt-2 text-[16px] leading-[1.6] text-white/80">
            Start onboarding. Let Jarvis calibrate your system.
          </p>
        </div>
        <a
          href="/app/onboarding/"
          className="inline-flex items-center justify-center rounded-[14px] border border-[color:rgba(0,212,255,0.32)] bg-[color:rgba(0,212,255,0.12)] px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-[color:rgba(0,212,255,0.92)] transition hover:border-[color:rgba(0,212,255,0.55)] hover:bg-[color:rgba(0,212,255,0.18)]"
        >
          BEGIN CALIBRATION
        </a>
      </section>
    </div>
  );
}

function toggleClass(active: boolean) {
  return (
    "rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.18em] transition " +
    (active
      ? "border-[color:rgba(0,212,255,0.5)] bg-[color:rgba(0,212,255,0.10)] text-[color:rgba(0,212,255,0.92)]"
      : "border-white/10 bg-white/5 text-white/55 hover:border-white/20 hover:bg-white/10 hover:text-white/80")
  );
}

function PlanCard({
  name,
  price,
  billing,
  items,
  badge,
  tone,
}: {
  name: string;
  price: number;
  billing: "monthly" | "yearly";
  items: string[];
  badge?: string;
  tone: "primary" | "neutral";
}) {
  const primary = tone === "primary";
  return (
    <motion.article
      whileHover={{ y: -2 }}
      transition={{ duration: 0.25 }}
      className={
        "relative overflow-hidden rounded-[22px] border bg-[color:var(--panel)] p-7 backdrop-blur-2xl " +
        (primary
          ? "border-[color:rgba(0,212,255,0.28)] shadow-[0_0_0_1px_rgba(0,212,255,0.08)_inset,0_22px_80px_rgba(0,0,0,0.55)]"
          : "border-white/10")
      }
    >
      {primary && (
        <div className="pointer-events-none absolute inset-0 opacity-[0.85] [background:radial-gradient(760px_420px_at_20%_0%,rgba(0,212,255,0.18),transparent_60%)]" />
      )}
      <div className="relative space-y-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">
            {name.toUpperCase()}
          </p>
          {badge && (
            <span className="rounded-full border border-[color:rgba(0,212,255,0.22)] bg-[color:rgba(0,212,255,0.10)] px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(0,212,255,0.9)]">
              {badge.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-end gap-2">
          <span className="text-4xl font-semibold tracking-[-0.03em] text-white">
            ${price}
          </span>
          <span className="pb-1 font-mono text-[10px] tracking-[0.18em] text-white/45">
            / {billing === "monthly" ? "MONTH" : "MONTH (BILLED YEARLY)"}
          </span>
        </div>
        <ul className="space-y-3 text-[14px] leading-[1.6] text-white/72">
          {items.map((it) => (
            <li key={it} className="flex gap-3">
              <span className="mt-[6px] h-2 w-2 rounded-full bg-white/25" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
        <a
          href="/app/onboarding/"
          className={
            "inline-flex w-full items-center justify-center rounded-[14px] border px-5 py-3 font-mono text-[11px] tracking-[0.18em] transition " +
            (primary
              ? "border-[color:rgba(0,212,255,0.32)] bg-[color:rgba(0,212,255,0.12)] text-[color:rgba(0,212,255,0.92)] hover:border-[color:rgba(0,212,255,0.55)] hover:bg-[color:rgba(0,212,255,0.18)]"
              : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white/85")
          }
        >
          GET STARTED
        </a>
      </div>
    </motion.article>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/5 p-5">
      <p className="font-mono text-[10px] tracking-[0.2em] text-white/55">{q}</p>
      <p className="mt-2 text-[14px] leading-[1.7] text-white/70">{a}</p>
    </div>
  );
}

