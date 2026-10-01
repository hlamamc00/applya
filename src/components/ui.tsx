import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "green";

const variants: Record<Variant, string> = {
  primary: "bg-navy text-white hover:bg-navy-soft",
  green: "bg-green text-white hover:brightness-95",
  secondary: "bg-white text-ink border border-mist hover:bg-cloud",
  ghost: "bg-transparent text-ink hover:bg-cloud",
  danger: "bg-white text-red border border-red/30 hover:bg-red-soft",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(base, variants[variant], className)} {...props} />;
}

export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-xl border border-mist bg-white p-5 sm:p-6", className)} {...props}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <h2 className="font-serif text-xl">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, intro, action }: { eyebrow?: string; title: string; intro?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="font-serif text-3xl sm:text-4xl">{title}</h1>
        {intro && <p className="mt-2 max-w-2xl text-graphite">{intro}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "navy";
const tones: Record<Tone, string> = {
  neutral: "bg-cloud text-graphite",
  green: "bg-green-soft text-green",
  amber: "bg-amber-soft text-amber",
  red: "bg-red-soft text-red",
  blue: "bg-blue-soft text-blue",
  navy: "bg-navy text-white",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn("rounded-md px-4 py-3 text-sm", tones[tone])}>{children}</div>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-mist bg-white/60 px-6 py-10 text-center">
      <p className="font-serif text-lg">{title}</p>
      {children && <div className="mt-2 text-sm text-graphite">{children}</div>}
    </div>
  );
}
