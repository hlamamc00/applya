import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./logo";

/** The narrow centred frame around the register / reset forms. */
export function AuthShell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-mist bg-white p-8 sm:p-10">
        <Logo width={160} />
        <h1 className="mt-8 font-serif text-3xl">{title}</h1>
        {intro && <p className="mt-2 text-sm text-graphite">{intro}</p>}
        <div className="mt-6">{children}</div>
        <p className="mt-8 text-xs text-graphite">
          <Link href="/">Sign in</Link> · <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
        </p>
      </div>
    </main>
  );
}
