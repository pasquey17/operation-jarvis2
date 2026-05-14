import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const ease = [0.22, 1, 0.36, 1] as const;

export function PricingPage() {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const plans = useMemo(() => {
    const monthly = {
      core: { amount: 15, unit: "month" as const },
      edge: { amount: 30, unit: "month" as const },
    };
    const yearly = {
      core: { amount: 144, unit: "year" as const, equivPerMonth: 12 },
      edge: { amount: 288, unit: "year" as const, equivPerMonth: 24 },
    };

    const isYearly = billing === "yearly";
    return {
      isYearly,
      core: {
        name: "CORE",
        positioning: "Build consistency. Understand your behaviour.",
        price: isYearly ? yearly.core.amount : monthly.core.amount,
        unit: isYearly ? yearly.core.unit : monthly.core.unit,
        billedLine: isYearly ? `$${yearly.core.equivPerMonth}/month billed yearly` : undefined,
        strikeMonthly: isYearly ? monthly.core.amount : undefined,
        cta: "Start Building Consistency",
        items: [
          "AI journaling system",
          "Trade / activity logging",
          "Basic performance insights",
          "Weekly summary reports",
          "Limited memory history",
          "Standard analytics dashboard",
        ],
      },
      edge: {
        name: "EDGE",
        positioning: "Full AI performance intelligence system.",
        price: isYearly ? yearly.edge.amount : monthly.edge.amount,
        unit: isYearly ? yearly.edge.unit : monthly.edge.unit,
        billedLine: isYearly ? `$${yearly.edge.equivPerMonth}/month billed yearly` : undefined,
        strikeMonthly: isYearly ? monthly.edge.amount : undefined,
        cta: "Activate Full Edge",
        badge: "Most Popular",
        items: [
          "Full behavioural memory system",
          "Deep pattern recognition across history",
          "AI coaching on decisions",
          "Real-time session insights",
          "Advanced performance analytics",
          "Unlimited history tracking",
          "Psychological behaviour mapping",
          "Priority AI intelligence layer",
          "Weekly + monthly reports",
        ],
      },
    };
  }, [billing]);

  return (
    <div className="space-y-12">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
        className="space-y-4"
      >
        <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">PRICING</p>
        <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white md:text-6xl">
          Choose the Jarvis tier that matches your seriousness.
        </h1>
        <p className="max-w-2xl text-pretty text-[15px] leading-[1.7] text-white/70 md:text-[16px]">
          This is not a generic journal. It's a discipline and execution system
          that remembers your patterns — and calls you out with specifics.
        </p>
        <BillingToggle billing={billing} setBilling={setBilling} />
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.12, ease }}
        className="grid gap-6 md:grid-cols-2"
      >
        <PlanCard
          name={plans.core.name}
          positioning={plans.core.positioning}
          price={plans.core.price}
          unit={plans.core.unit}
          billedLine={plans.core.billedLine}
          strikeMonthly={plans.core.strikeMonthly}
          tone="neutral"
          cta={plans.core.cta}
          items={plans.core.items}
        />
        <PlanCard
          tone="primary"
          badge={plans.edge.badge}
          name={plans.edge.name}
          positioning={plans.edge.positioning}
          price={plans.edge.price}
          unit={plans.edge.unit}
          billedLine={plans.edge.billedLine}
          strikeMonthly={plans.edge.strikeMonthly}
          cta={plans.edge.cta}
          items={plans.edge.items}
          savingsBadge={plans.isYearly ? "Save 20%" : undefined}
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.22, ease }}
        className="overflow-hidden rounded-[22px] border border-white/10 bg-[color:var(--panel)] p-8 backdrop-blur-2xl md:p-10"
      >
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.85)]">FAQ</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-white">Straight answers.</h2>
            <p className="mt-3 text-[14px] leading-[1.7] text-white/70">
              Jarvis is private tooling. No hype. No generic coaching.
            </p>
          </div>
          <div className="space-y-3">
            <FaqAccordion
              q="Is this a signal service?"
              a="No. Jarvis is an execution + discipline system built around your own history."
            />
            <FaqAccordion
              q="Do I need to migrate data?"
              a="No. The new UI reads from the existing APIs and keeps everything intact."
            />
            <FaqAccordion
              q="Can I use it on mobile?"
              a="Yes. The new `/app/*` layer is designed mobile-first."
            />
          </div>
        </div>
      </motion.section>

      <section className="flex flex-col items-start justify-between gap-6 rounded-[22px] border border-[color:rgba(0,212,255,0.16)] bg-[color:rgba(0,212,255,0.06)] p-8 backdrop-blur-2xl md:flex-row md:items-center md:p-10">
        <div>
          <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.85)]">READY</p>
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

function BillingToggle({
  billing,
  setBilling,
}: {
  billing: "monthly" | "yearly";
  setBilling: (v: "monthly" | "yearly") => void;
}) {
  const isYearly = billing === "yearly";
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <div className="flex items-center gap-3">
        <span className={"font-mono text-[10px] tracking-[0.18em] transition " + (isYearly ? "text-white/45" : "text-white/80")}>
          MONTHLY
        </span>
        <button
          type="button"
          aria-label="Toggle billing period"
          onClick={() => setBilling(isYearly ? "monthly" : "yearly")}
          className={
            "relative h-9 w-[86px] rounded-full border backdrop-blur-2xl transition outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(0,212,255,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a] " +
            (isYearly
              ? "border-[color:rgba(0,255,136,0.26)] bg-[color:rgba(0,255,136,0.08)]"
              : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8")
          }
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className={
              "absolute top-[4px] h-[26px] w-[40px] rounded-full border " +
              (isYearly
                ? "left-[42px] border-[color:rgba(0,255,136,0.26)] bg-[color:rgba(0,0,0,0.25)]"
                : "left-[4px] border-[color:rgba(0,212,255,0.22)] bg-[color:rgba(0,0,0,0.25)]")
            }
          />
        </button>
        <span className={"font-mono text-[10px] tracking-[0.18em] transition " + (isYearly ? "text-white/80" : "text-white/45")}>
          YEARLY
        </span>
      </div>
      <span className="rounded-full border border-[color:rgba(0,255,136,0.22)] bg-[color:rgba(0,255,136,0.08)] px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(0,255,136,0.9)]">
        SAVE ~20%
      </span>
    </div>
  );
}

function PlanCard({
  name,
  positioning,
  price,
  unit,
  billedLine,
  strikeMonthly,
  items,
  cta,
  badge,
  tone,
  savingsBadge,
}: {
  name: string;
  positioning: string;
  price: number;
  unit: "month" | "year";
  billedLine?: string;
  strikeMonthly?: number;
  items: string[];
  cta: string;
  badge?: string;
  tone: "primary" | "neutral";
  savingsBadge?: string;
}) {
  const reduce = useReducedMotion();
  const primary = tone === "primary";
  return (
    <motion.article
      whileHover={reduce ? undefined : { y: primary ? -4 : -2, scale: primary ? 1.005 : 1 }}
      transition={{ duration: 0.25, ease }}
      className={
        "relative overflow-hidden rounded-[22px] border bg-[color:var(--panel)] p-7 backdrop-blur-2xl " +
        (primary
          ? "border-[color:rgba(0,212,255,0.32)] shadow-[0_0_0_1px_rgba(0,212,255,0.08)_inset,0_22px_80px_rgba(0,0,0,0.55),0_0_48px_rgba(0,212,255,0.06)]"
          : "border-white/10")
      }
    >
      {primary && (
        <>
          <div className="pointer-events-none absolute inset-0 opacity-[0.85] [background:radial-gradient(760px_420px_at_20%_0%,rgba(0,212,255,0.18),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 [background:radial-gradient(400px_260px_at_80%_100%,rgba(0,212,255,0.06),transparent_55%)]" />
        </>
      )}
      <div className="relative space-y-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">{name.toUpperCase()}</p>
          <div className="flex items-center gap-2">
            {savingsBadge && (
              <span className="rounded-full border border-[color:rgba(0,255,136,0.22)] bg-[color:rgba(0,255,136,0.08)] px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(0,255,136,0.9)]">
                {savingsBadge.toUpperCase()}
              </span>
            )}
            {badge && (
              <span className="rounded-full border border-[color:rgba(0,212,255,0.35)] bg-[color:rgba(0,212,255,0.12)] px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-[color:rgba(0,212,255,0.95)] shadow-[0_0_14px_rgba(0,212,255,0.25)]">
                {badge.toUpperCase()}
              </span>
            )}
          </div>
        </div>
        <p className="text-[14px] leading-[1.7] text-white/70">{positioning}</p>
        <div className="flex items-end gap-2">
          <div className="flex items-end gap-3">
            <AnimatePresence mode="wait">
              <motion.span
                key={price}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.3, ease }}
                className="text-4xl font-semibold tracking-[-0.03em] text-white"
              >
                ${price}
              </motion.span>
            </AnimatePresence>
            {typeof strikeMonthly === "number" && (
              <span className="pb-1 text-[13px] text-white/45 line-through">${strikeMonthly}/mo</span>
            )}
          </div>
          <span className="pb-1 font-mono text-[10px] tracking-[0.18em] text-white/45">
            / {unit === "month" ? "MONTH" : "YEAR"}
          </span>
        </div>
        {billedLine && (
          <p className="font-mono text-[10px] tracking-[0.18em] text-white/45">{billedLine.toUpperCase()}</p>
        )}
        <ul className="space-y-3 text-[14px] leading-[1.6] text-white/72">
          {items.map((it) => (
            <li key={it} className="flex gap-3">
              <span
                className={
                  "mt-[3px] flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold " +
                  (primary
                    ? "bg-[color:rgba(0,212,255,0.14)] text-[color:rgba(0,212,255,0.95)]"
                    : "bg-white/8 text-white/45")
                }
              >
                {primary ? "✓" : "·"}
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
        <a
          href="/app/onboarding/"
          className={
            "inline-flex w-full items-center justify-center rounded-[14px] border px-5 py-3 font-mono text-[11px] tracking-[0.18em] transition " +
            (primary
              ? "border-[color:rgba(0,212,255,0.32)] bg-[color:rgba(0,212,255,0.12)] text-[color:rgba(0,212,255,0.92)] hover:border-[color:rgba(0,212,255,0.55)] hover:bg-[color:rgba(0,212,255,0.18)] hover:shadow-[0_0_24px_rgba(0,212,255,0.2)]"
              : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white/85")
          }
        >
          {cta.toUpperCase()}
        </a>
      </div>
    </motion.article>
  );
}

function FaqAccordion({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={
        "overflow-hidden rounded-[18px] border transition-colors duration-200 " +
        (open ? "border-[color:rgba(0,212,255,0.22)] bg-[color:rgba(0,212,255,0.04)]" : "border-white/10 bg-white/5")
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(0,212,255,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a]"
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-white/72">{q}</p>
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.25, ease }}
          className="flex-shrink-0 font-mono text-[18px] leading-none text-[color:rgba(0,212,255,0.75)]"
        >
          +
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease }}
          >
            <p className="px-5 pb-5 text-[14px] leading-[1.7] text-white/65">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
