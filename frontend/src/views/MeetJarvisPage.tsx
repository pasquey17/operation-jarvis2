import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "../lib/jarvisAuth";

type CalibrationLevel = "none" | "watching" | "early" | "calibrated" | "full";

type JarvisIntroData = {
  trade_count: number;
  win_rate: number | null;
  best_setup: string | null;
  top_observations: string[];
  calibration_level: CalibrationLevel;
};

const ease = [0.22, 1, 0.36, 1] as const;

type IntroContent = {
  heading: string;
  body: string;
  prompts: [string, string];
};

function buildContent(data: JarvisIntroData): IntroContent {
  const { calibration_level, trade_count, win_rate, top_observations } = data;
  const obs = top_observations;
  const n = trade_count;

  switch (calibration_level) {
    case "none":
      return {
        heading: "I'm Jarvis.",
        body: "I get smarter with every trade you log. I haven't seen any of your trades yet — but I'm ready to start learning. Log your first trade and I'll begin building your profile.",
        prompts: ["What should I track in my first trade?", "How does Jarvis work?"],
      };
    case "watching":
      return {
        heading: "I'm Jarvis.",
        body: `I've pulled in your ${n} trade${n !== 1 ? "s" : ""} and I'm starting to build your profile. I'll have a lot more to say once I've seen 30 or more trades. Ask me anything about what you've got so far.`,
        prompts: ["What have you noticed so far?", "What should I focus on right now?"],
      };
    case "early":
      return {
        heading: "I'm starting to see something.",
        body: `I've read through your ${n} trades. Early patterns are forming.${obs[0] ? ` ${obs[0]}.` : ""} Keep logging — the picture gets clearer every trade.`,
        prompts: ["What patterns are you seeing?", "Where am I losing the most?"],
      };
    case "calibrated":
      return {
        heading: "I know your trading.",
        body: `I've analysed your ${n} trades and I've got a clear picture.${obs[0] ? ` ${obs[0]}.` : ""}${obs[1] ? ` ${obs[1]}.` : ""} Ask me anything.`,
        prompts: ["What's my biggest weakness right now?", "Run a Deep Think on my last 30 trades"],
      };
    case "full":
      return {
        heading: "Let's get to work.",
        body: `I've read your ${n} trades.${win_rate != null ? ` Win rate: ${win_rate}%.` : ""}${obs[0] ? ` ${obs[0]}.` : ""}${obs[1] ? ` ${obs[1]}.` : ""} I know where you're leaking money. Ask me.`,
        prompts: ["What's costing me the most?", "Run a Deep Think"],
      };
  }
}

const FALLBACK: JarvisIntroData = {
  trade_count: 0,
  win_rate: null,
  best_setup: null,
  top_observations: [],
  calibration_level: "none",
};

export function MeetJarvisPage() {
  const [data, setData] = useState<JarvisIntroData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch("/api/user/jarvis-intro");
        if (res.ok) {
          const d = (await res.json()) as JarvisIntroData;
          setData(d);
        }
      } catch {
        /* silent — fallback handles it */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const intro = data ?? FALLBACK;
  const content = buildContent(intro);

  function goWithPrompt(prompt: string) {
    window.location.href = "/index.html?jarvis_prompt=" + encodeURIComponent(prompt);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease }}
      className="mx-auto w-[min(680px,100%)]"
    >
      <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[color:var(--panel)] backdrop-blur-2xl">
        {loading ? (
          <div className="flex flex-col items-center justify-center px-10 py-24">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-full border-2 border-white/10" />
              <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[color:rgba(0,212,255,0.85)]" />
            </div>
            <p className="mt-5 font-mono text-[10px] tracking-[0.22em] text-white/40">
              READING YOUR DATA…
            </p>
          </div>
        ) : (
          <div className="px-7 py-10 md:px-10 md:py-14">
            {/* Icon */}
            <div className="mb-8 flex justify-center">
              <div className="relative h-16 w-16">
                <div
                  className="absolute inset-0 rounded-full bg-[color:rgba(0,212,255,0.18)] blur-2xl"
                  style={{ transform: "scale(1.6)" }}
                />
                <div className="relative flex h-full w-full items-center justify-center rounded-full border border-[color:rgba(0,212,255,0.35)] bg-[color:rgba(0,212,255,0.07)]">
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 28 28"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M14 2 L15.6 12.4 L26 14 L15.6 15.6 L14 26 L12.4 15.6 L2 14 L12.4 12.4 Z"
                      fill="rgba(0,212,255,0.9)"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Eyebrow */}
            <p className="text-center font-mono text-[10px] tracking-[0.22em] text-[color:rgba(0,212,255,0.85)]">
              MEET JARVIS
            </p>

            {/* Heading */}
            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease }}
              className="mt-3 text-center text-3xl font-semibold tracking-[-0.03em] text-white md:text-5xl"
            >
              {content.heading}
            </motion.h1>

            {/* Body */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2, ease }}
              className="mx-auto mt-5 max-w-md text-center text-[15px] leading-[1.75] text-white/70"
            >
              {content.body}
            </motion.p>

            {/* Prompt chips */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.35, ease }}
              className="mt-9 flex flex-wrap justify-center gap-3"
            >
              {content.prompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => goWithPrompt(prompt)}
                  className="rounded-full border border-[color:rgba(0,212,255,0.35)] bg-[color:rgba(0,212,255,0.06)] px-5 py-2.5 font-mono text-[11px] tracking-[0.12em] text-[color:rgba(0,212,255,0.85)] transition hover:border-[color:rgba(0,212,255,0.6)] hover:bg-[color:rgba(0,212,255,0.14)] hover:shadow-[0_0_16px_rgba(0,212,255,0.2)]"
                >
                  {prompt}
                </button>
              ))}
            </motion.div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5, ease }}
              className="mt-10 flex justify-center"
            >
              <a
                href="/index.html"
                className="inline-flex items-center gap-2 rounded-[14px] border border-[color:rgba(0,212,255,0.32)] bg-[color:rgba(0,212,255,0.12)] px-8 py-3.5 font-mono text-[11px] tracking-[0.18em] text-[color:rgba(0,212,255,0.92)] transition hover:border-[color:rgba(0,212,255,0.55)] hover:bg-[color:rgba(0,212,255,0.18)] hover:shadow-[0_0_24px_rgba(0,212,255,0.2)]"
              >
                Talk to Jarvis →
              </a>
            </motion.div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
