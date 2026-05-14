/**
 * Single signature layer: fine grid + vignette (no video, no canvas — Lighthouse-friendly).
 * Lives under page content (fixed, pointer-events none).
 */
export function JarvisBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      {/* Deep base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 120% 80% at 50% -20%, rgba(0, 212, 255, 0.09), transparent 50%), radial-gradient(ellipse 90% 60% at 100% 0%, rgba(80, 60, 160, 0.12), transparent 45%), linear-gradient(180deg, #020308 0%, #05070f 40%, #07070a 100%)",
        }}
      />
      {/* Fine HUD grid */}
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0, 212, 255, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 212, 255, 0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Soft top sheen */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent to-[28%]" />
      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.55)_100%)]" />
    </div>
  );
}
