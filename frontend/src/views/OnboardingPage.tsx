import { useMemo, useState } from "react";
import { motion } from "framer-motion";

type StepKey =
  | "welcome"
  | "style"
  | "markets"
  | "windows"
  | "struggle"
  | "goals"
  | "calibrating";

type OnboardingState = {
  email: string;
  style: "scalper" | "intraday" | "swing" | "";
  markets: string[];
  windows: string[];
  struggle: string;
  goals: string;
};

const DEFAULT: OnboardingState = {
  email: "",
  style: "",
  markets: [],
  windows: [],
  struggle: "",
  goals: "",
};

export function OnboardingPage() {
  const [step, setStep] = useState<StepKey>("welcome");
  const [s, setS] = useState<OnboardingState>(() => {
    try {
      const raw = localStorage.getItem("jarvis_onboarding");
      return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
    } catch {
      return DEFAULT;
    }
  });

  const stepIx = useMemo(() => {
    const order: StepKey[] = [
      "welcome",
      "style",
      "markets",
      "windows",
      "struggle",
      "goals",
      "calibrating",
    ];
    return { order, i: order.indexOf(step) };
  }, [step]);

  function persist(next: Partial<OnboardingState>) {
    const merged = { ...s, ...next };
    setS(merged);
    try {
      localStorage.setItem("jarvis_onboarding", JSON.stringify(merged));
    } catch {}
  }

  function next() {
    const o = stepIx.order;
    const i = stepIx.i;
    if (i < 0 || i >= o.length - 1) return;
    setStep(o[i + 1]);
  }
  function back() {
    const o = stepIx.order;
    const i = stepIx.i;
    if (i <= 0) return;
    setStep(o[i - 1]);
  }

  async function finish() {
    const email = (s.email || "").trim() || "aidenpasque11@gmail.com";
    try {
      localStorage.setItem("jarvis_user", email);
      localStorage.setItem("user_id", email);
    } catch {}
    setStep("calibrating");
    // cinematic pause
    await sleep(1200);
    window.location.href = "/app/dashboard/";
  }

  return (
    <div className="mx-auto w-[min(980px,100%)]">
      <div className="mb-7 flex items-center justify-between gap-4">
        <a
          href="/app/"
          className="font-mono text-[10px] tracking-[0.22em] text-white/55 transition hover:text-white/80"
        >
          ← EXIT
        </a>
        <div className="font-mono text-[10px] tracking-[0.22em] text-white/40">
          CALIBRATION {Math.max(1, stepIx.i + 1)} / {stepIx.order.length}
        </div>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[color:var(--panel)] backdrop-blur-2xl">
        <div className="border-b border-white/10 bg-black/20 px-7 py-5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[color:rgba(0,212,255,0.75)] transition-all duration-500"
              style={{
                width:
                  ((Math.max(0, stepIx.i) + 1) / stepIx.order.length) * 100 +
                  "%",
              }}
            />
          </div>
        </div>

        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="px-7 py-8 md:px-10 md:py-10"
        >
          {step === "welcome" && (
            <Step
              eyebrow="WELCOME"
              title="Let’s build your Jarvis layer."
              desc="This is not signup. It’s calibration — so the system feels like it knows you."
            >
              <Field
                label="Preferred email (used as your profile key)"
                hint="This is just stored locally as `jarvis_user`."
              >
                <input
                  value={s.email}
                  onChange={(e) => persist({ email: e.target.value })}
                  placeholder="e.g. aidenpasque11@gmail.com"
                  className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-3 text-[14px] text-white/80 outline-none transition focus:border-[color:rgba(0,212,255,0.45)] focus:bg-white/7"
                />
              </Field>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <PrimaryButton onClick={next}>BEGIN</PrimaryButton>
                <SecondaryButton href="/app/dashboard/">
                  SKIP (DASH)
                </SecondaryButton>
              </div>
            </Step>
          )}

          {step === "style" && (
            <Step
              eyebrow="STYLE"
              title="How do you trade?"
              desc="We use this to tune the tone of coaching."
            >
              <div className="grid gap-3 md:grid-cols-3">
                {(["scalper", "intraday", "swing"] as const).map((v) => (
                  <Choice
                    key={v}
                    active={s.style === v}
                    label={v.toUpperCase()}
                    onClick={() => persist({ style: v })}
                  />
                ))}
              </div>
              <NavRow onBack={back} onNext={next} />
            </Step>
          )}

          {step === "markets" && (
            <Step
              eyebrow="MARKETS"
              title="What do you trade most?"
              desc="We’ll reference instruments explicitly when coaching."
            >
              <div className="grid gap-3 md:grid-cols-2">
                {["XAU/USD", "AUD/USD", "NASDAQ", "FOREX MAJORS"].map((m) => (
                  <Choice
                    key={m}
                    active={s.markets.includes(m)}
                    label={m}
                    onClick={() =>
                      persist({
                        markets: toggle(s.markets, m),
                      })
                    }
                  />
                ))}
              </div>
              <NavRow onBack={back} onNext={next} />
            </Step>
          )}

          {step === "windows" && (
            <Step
              eyebrow="WINDOWS"
              title="When do you trade?"
              desc="This powers session reminders and context."
            >
              <div className="grid gap-3 md:grid-cols-3">
                {["Asia", "London", "New York", "London/New York"].map((w) => (
                  <Choice
                    key={w}
                    active={s.windows.includes(w)}
                    label={w.toUpperCase()}
                    onClick={() =>
                      persist({
                        windows: toggle(s.windows, w),
                      })
                    }
                  />
                ))}
              </div>
              <NavRow onBack={back} onNext={next} />
            </Step>
          )}

          {step === "struggle" && (
            <Step
              eyebrow="PSYCHOLOGY"
              title="What derails you most?"
              desc="Jarvis will watch for this and call it out with dated examples."
            >
              <textarea
                value={s.struggle}
                onChange={(e) => persist({ struggle: e.target.value })}
                rows={5}
                placeholder="e.g. I chase after losses, I hesitate on A+ setups..."
                className="w-full rounded-[16px] border border-white/10 bg-white/5 px-4 py-3 text-[14px] leading-[1.6] text-white/80 outline-none transition focus:border-[color:rgba(0,212,255,0.45)]"
              />
              <NavRow onBack={back} onNext={next} />
            </Step>
          )}

          {step === "goals" && (
            <Step
              eyebrow="GOALS"
              title="What are we building toward?"
              desc="One clear goal keeps the system honest."
            >
              <textarea
                value={s.goals}
                onChange={(e) => persist({ goals: e.target.value })}
                rows={4}
                placeholder="e.g. 4 weeks of rule adherence + consistent execution..."
                className="w-full rounded-[16px] border border-white/10 bg-white/5 px-4 py-3 text-[14px] leading-[1.6] text-white/80 outline-none transition focus:border-[color:rgba(0,212,255,0.45)]"
              />
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <SecondaryButton onClick={back}>BACK</SecondaryButton>
                <PrimaryButton onClick={finish}>CALIBRATE</PrimaryButton>
              </div>
            </Step>
          )}

          {step === "calibrating" && (
            <div className="py-14 text-center">
              <p className="font-mono text-[10px] tracking-[0.22em] text-white/55">
                JARVIS IS PREPARING YOUR SYSTEM…
              </p>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-[15px] leading-[1.7] text-white/70">
                Mapping your profile. Loading memory anchors. Preparing mission
                control.
              </p>
              <div className="mx-auto mt-8 h-1.5 w-[min(460px,92%)] overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/2 animate-[pulse_1.6s_ease-in-out_infinite] rounded-full bg-[color:rgba(0,212,255,0.75)]" />
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function Step({
  eyebrow,
  title,
  desc,
  children,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.85)]">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-white md:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-[14px] leading-[1.7] text-white/70">
        {desc}
      </p>
      <div className="mt-7">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.18em] text-white/55">
        {label.toUpperCase()}
      </p>
      {hint && (
        <p className="mt-2 text-[13px] leading-[1.6] text-white/55">{hint}</p>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Choice({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-[18px] border p-5 text-left font-mono text-[11px] tracking-[0.18em] transition " +
        (active
          ? "border-[color:rgba(0,212,255,0.55)] bg-[color:rgba(0,212,255,0.10)] text-[color:rgba(0,212,255,0.92)]"
          : "border-white/10 bg-white/5 text-white/65 hover:border-white/20 hover:bg-white/8 hover:text-white/85")
      }
    >
      {label}
    </button>
  );
}

function NavRow({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <SecondaryButton onClick={onBack}>BACK</SecondaryButton>
      <PrimaryButton onClick={onNext}>NEXT</PrimaryButton>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex w-full items-center justify-center rounded-[14px] border border-[color:rgba(0,212,255,0.32)] bg-[color:rgba(0,212,255,0.12)] px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-[color:rgba(0,212,255,0.92)] transition hover:border-[color:rgba(0,212,255,0.55)] hover:bg-[color:rgba(0,212,255,0.18)] sm:w-auto"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  href,
  onClick,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const cls =
    "inline-flex w-full items-center justify-center rounded-[14px] border border-white/10 bg-white/5 px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-white/70 transition hover:border-white/20 hover:bg-white/10 hover:text-white/85 sm:w-auto";
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

function toggle(arr: string[], v: string) {
  return arr.includes(v) ? arr.filter((x) => x !== v) : arr.concat(v);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

