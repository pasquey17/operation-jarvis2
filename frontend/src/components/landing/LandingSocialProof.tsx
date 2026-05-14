export function LandingSocialProof() {
  return (
    <div className="mx-auto w-full max-w-[900px] text-center">
      <p className="font-mono text-[10px] tracking-[0.28em] text-[color:var(--faint)]">PROOF</p>
      <h2 className="mt-4 text-balance text-2xl font-semibold tracking-[-0.02em] text-[color:var(--text)] md:text-4xl">
        Private beta. Real traders. No public leaderboard theatre.
      </h2>
      <p className="mx-auto mt-4 max-w-[56ch] text-[14px] leading-[1.85] text-[color:var(--muted)]">
        Jarvis is being shaped with a small circle focused on execution quality. If you want in,
        start calibration — we will prioritise traders who already journal with intent.
      </p>
      <ul className="mx-auto mt-8 flex max-w-[720px] flex-col gap-3 text-left sm:flex-row sm:justify-center sm:gap-4">
        <li className="flex-1 rounded-[18px] border border-[color:var(--border)] bg-black/25 px-5 py-4 font-mono text-[10px] tracking-[0.16em] text-[color:var(--muted)] backdrop-blur-md">
          <span className="text-[color:rgba(0,212,255,0.85)]">01</span>
          <span className="mx-2 text-[color:var(--faint)]">—</span>
          INVITE-FIRST ACCESS
        </li>
        <li className="flex-1 rounded-[18px] border border-[color:var(--border)] bg-black/25 px-5 py-4 font-mono text-[10px] tracking-[0.16em] text-[color:var(--muted)] backdrop-blur-md">
          <span className="text-[color:rgba(0,212,255,0.85)]">02</span>
          <span className="mx-2 text-[color:var(--faint)]">—</span>
          BUILT ON YOUR HISTORY
        </li>
        <li className="flex-1 rounded-[18px] border border-[color:var(--border)] bg-black/25 px-5 py-4 font-mono text-[10px] tracking-[0.16em] text-[color:var(--muted)] backdrop-blur-md">
          <span className="text-[color:rgba(0,212,255,0.85)]">03</span>
          <span className="mx-2 text-[color:var(--faint)]">—</span>
          NO SIGNALS / NO HYPE
        </li>
      </ul>
    </div>
  );
}
