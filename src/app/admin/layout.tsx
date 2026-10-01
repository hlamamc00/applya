import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Logo } from "@/components/logo";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 bg-navy px-6 py-3 text-sm text-white">
        <div className="flex items-center gap-6">
          <Logo dark width={110} href="/app" />
          <nav className="flex gap-4 text-[#c7d2d6]">
            <Link href="/admin" className="hover:text-white">
              Sources & scans
            </Link>
            <Link href="/admin/users" className="hover:text-white">
              Users
            </Link>
          </nav>
        </div>
        <Link href="/app" className="text-[#c7d2d6] hover:text-white">
          ← Back to the workspace
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
