const faqs: { q: string; a: string }[] = [
  {
    q: "Is Jarvis a signal service?",
    a: "No. It is an execution and discipline layer grounded in your own trades — not buy/sell calls.",
  },
  {
    q: "Will this replace my journal?",
    a: "It amplifies it. Jarvis reads structure from your history so coaching stays specific instead of generic.",
  },
  {
    q: "Can I use it on mobile?",
    a: "Yes. The /app layer is touch-friendly and keeps the same information hierarchy as desktop.",
  },
  {
    q: "Where does my data live?",
    a: "The classic HUD uses your existing backend; onboarding stores a lightweight profile key locally until you wire more.",
  },
];

export function LandingFaq() {
  return (
    <div className="mx-auto grid w-full max-w-[980px] gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-start">
      <div>
        <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">FAQ</p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-[1.06] tracking-[-0.03em] text-[color:var(--text)] md:text-4xl">
          Straight answers.
        </h2>
        <p className="mt-4 max-w-[42ch] text-[14px] leading-[1.85] text-[color:var(--muted)]">
          No enterprise filler. If something is not true in-product yet, we say so.
        </p>
      </div>
      <div className="space-y-2">
        {faqs.map((item) => (
          <details
            key={item.q}
            className="group overflow-hidden rounded-[18px] border border-[color:var(--border)] bg-black/25 backdrop-blur-md open:border-[color:rgba(0,212,255,0.22)] open:bg-[color:rgba(0,212,255,0.04)]"
          >
            <summary className="cursor-pointer list-none px-5 py-4 font-mono text-[10px] tracking-[0.18em] text-[color:var(--text)] outline-none transition marker:content-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-[color:rgba(0,212,255,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a]">
              <span className="flex items-center justify-between gap-3">
                <span>{item.q}</span>
                <span className="text-[color:rgba(0,212,255,0.75)] transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="border-t border-[color:var(--border2)] px-5 pb-4 pt-0 text-[14px] leading-[1.75] text-[color:var(--muted)]">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
