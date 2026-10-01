import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { BRAND } from "@/lib/types";

export function LegalShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Logo width={140} />
        <nav className="flex gap-4 text-sm text-graphite">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </header>
      <article className="prose-legal rounded-2xl border border-mist bg-white p-8 sm:p-10">
        <h1 className="font-serif text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-graphite">Last updated: {updated}</p>
        <p className="text-sm text-graphite">
          {BRAND.operator} · <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
        </p>
        {children}
        <p className="mt-10 text-xs text-graphite">You can print or save this page using your browser.</p>
      </article>
    </main>
  );
}
