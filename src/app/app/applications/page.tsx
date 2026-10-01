import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { APPLICATION_STATUS_LABELS, APPLICATION_STATUSES } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Empty, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser("/app/applications");
  const { status = "" } = await searchParams;
  const where = { userId: user.id, ...(status ? { status } : {}) };
  const apps = await db.application.findMany({ where, orderBy: { updatedAt: "desc" }, include: { job: true }, take: 300 });
  const counts = await db.application.groupBy({ by: ["status"], where: { userId: user.id }, _count: true });
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const total = counts.reduce((n, c) => n + c._count, 0);

  return (
    <>
      <PageHeader eyebrow="Applications" title="Your applications" intro="Each one holds a tailored CV, a message and its history. Approving records the exact CV version you reviewed; marking it submitted is a separate step, after you've sent it." />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-mist">
        <Link href="/app/applications" className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", !status ? "border-green text-ink" : "border-transparent text-graphite")}>
          All <span className="ml-1 text-xs text-steel">{total}</span>
        </Link>
        {APPLICATION_STATUSES.map((s) => (
          <Link key={s} href={`/app/applications?status=${s}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", status === s ? "border-green text-ink" : "border-transparent text-graphite")}>
            {APPLICATION_STATUS_LABELS[s]} <span className="ml-1 text-xs text-steel">{count(s)}</span>
          </Link>
        ))}
      </nav>
      {apps.length === 0 ? (
        <Empty title="No applications here">Drafts are prepared from strong matches, or from the “Prepare tailored draft” button on any job.</Empty>
      ) : (
        <ul className="divide-y divide-mist rounded-xl border border-mist bg-white">
          {apps.map((a) => (
            <li key={a.id}>
              <Link href={`/app/applications/${a.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-cloud">
                <span className="min-w-0">
                  <span className="block font-semibold">{a.job.title}</span>
                  <span className="block text-sm text-graphite">
                    {a.job.company}
                    {a.job.location ? ` · ${a.job.location}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-sm text-graphite">
                  <span>{formatDate(a.updatedAt)}</span>
                  <StatusBadge status={a.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
