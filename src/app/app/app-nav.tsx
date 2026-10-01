"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Briefcase, FileText, LayoutDashboard, Menu, Search, Settings, Shield, SlidersHorizontal, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const items = [
  { href: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/app/jobs", label: "Matches", icon: Search },
  { href: "/app/applications", label: "Applications", icon: Briefcase },
  { href: "/app/profile", label: "Profile & CV", icon: FileText },
  { href: "/app/preferences", label: "Job preferences", icon: SlidersHorizontal },
  { href: "/app/settings", label: "Account", icon: Settings },
];

export function AppNav({ user }: { user: { name: string; email: string; isAdmin: boolean } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = user.isAdmin ? [...items, { href: "/admin", label: "Admin", icon: Shield }] : items;

  const nav = (
    <nav className="flex flex-col gap-1">
      {links.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[#c7d2d6] transition-colors hover:bg-navy-soft hover:text-white",
              active && "bg-navy-soft text-white",
            )}
          >
            <Icon size={17} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <header className="flex items-center justify-between bg-navy px-5 py-3 lg:hidden">
        <Logo dark width={110} href="/app" />
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-white" aria-label="Menu">
          {open ? <X /> : <Menu />}
        </button>
      </header>
      {open && <div className="bg-navy px-5 pb-5 lg:hidden">{nav}</div>}
      <aside className="sticky top-0 hidden h-screen flex-col bg-navy px-4 py-6 lg:flex">
        <div className="px-3">
          <Logo dark width={130} href="/app" />
        </div>
        <div className="mt-8 flex-1">{nav}</div>
        <div className="border-t border-navy-soft px-3 pt-4 text-xs text-[#9fb0b6]">
          <p className="truncate font-semibold text-white">{user.name}</p>
          <p className="truncate">{user.email}</p>
          <form action="/logout" method="post" className="mt-3">
            <button type="submit" className="text-[#c7d2d6] underline hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
