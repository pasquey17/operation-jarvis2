import type { PropsWithChildren } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

export function Button({
  as,
  href,
  onClick,
  variant = "secondary",
  size = "md",
  children,
}: PropsWithChildren<{
  as?: "a" | "button";
  href?: string;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
}>) {
  const Tag: any = as === "a" || href ? "a" : "button";
  const base =
    "inline-flex items-center justify-center rounded-[14px] border font-mono tracking-[0.18em] transition select-none outline-none focus-visible:ring-2 focus-visible:ring-[color:rgba(0,212,255,0.5)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a] " +
    (size === "sm" ? "px-4 py-2 text-[10px]" : "px-5 py-3 text-[11px]");
  const cls =
    base +
    " " +
    (variant === "primary"
      ? "border-[color:rgba(0,212,255,0.32)] bg-[color:rgba(0,212,255,0.12)] text-[color:rgba(0,212,255,0.92)] hover:border-[color:rgba(0,212,255,0.55)] hover:bg-[color:rgba(0,212,255,0.18)]"
      : variant === "ghost"
        ? "border-transparent bg-transparent text-white/65 hover:bg-white/5 hover:text-white/85"
        : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:bg-white/10 hover:text-white/85");

  return (
    <Tag
      href={href}
      onClick={onClick}
      className={cls}
      type={Tag === "button" ? "button" : undefined}
    >
      {children}
    </Tag>
  );
}

