import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, truncate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Empty, PageHeader } from "@/components/ui";
import { ScoreBadge } from "@/components/status-badge";
import { ScanButton } from "./scan-button";
import { MatchActions } from "./match-actions";

export const metadata: Metadata = { title: "Matches" };

const tabs = [
  { key: "NEW", label: "New" },
  { key: "SHORTLISTED", label: "Shortlisted" },
  { key: "DRAFTED", label: "Drafted" },
  { key: "DISMISSED", label: "Dismissed" },
];

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser("/app/jobs");
  const { status = "NEW" } = await searchParams;
  const matches = await db.match.findMany({
    where: { userId: user.id, status, job: status === "NEW" ? { closedAt: null } : undefined },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    include: { job: { include: { source: { select: { name: true } } } } },
    take: 200,
  });
  const counts = Object.fromEntries(
    await Promise.all(tabs.map(async (t) => [t.key, await db.match.count({ where: { userId: user.id, status: t.key, job: t.key === "NEW" ? { closedAt: null } : undefined } })])),
  ) as Record<string, number>;

  return (
    <>
      <PageHeader eyebrow="Matches" title="Jobs that fit your preferences" intro="Scored against your keywords, locations, level and areas. Shortlist the ones you like, dismiss the rest, and prepare a tailored draft when you're ready." action={<ScanButton />} />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-mist">
        {tabs.map((t) => (
          <Link key={t.key} href={`/app/jobs?status=${t.key}`} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", status === t.key ? "border-green text-ink" : "border-transparent text-graphite hover:text-ink")}>
            {t.label} <span className="ml-1 text-xs text-steel">{counts[t.key]}</span>
          </Link>
        ))}
      </nav>
      {matches.length === 0 ? (
        <Empty title={status === "NEW" ? "No new matches" : "Nothing here"}>
          {status === "NEW" && "Run a scan, or widen your preferences if scans keep coming back empty."}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {matches.map((m) => (
            <li key={m.id} className="rounded-xl border border-mist bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/app/jobs/${m.jobId}`} className="font-serif text-lg hover:underline">
                    {m.job.title}
                  </Link>
                  <p className="text-sm text-graphite">
                    {m.job.company}
                    {m.job.location ? ` · ${m.job.location}` : ""}
                    {m.job.remote ? " · Remote" : ""}
                    {m.job.salary ? ` · ${m.job.salary}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-steel">
                    {m.job.source.name}
                    {m.job.postedAt ? ` · posted ${formatDate(m.job.postedAt)}` : ` · seen ${formatDate(m.job.firstSeenAt)}`}
                    {m.job.closedAt ? " · no longer listed" : ""}
                  </p>
                </div>
                <ScoreBadge score={m.score} />
              </div>
              {Array.isArray(m.reasons) && m.reasons.length > 0 && <p className="mt-2 text-sm text-graphite">{(m.reasons as string[]).join(" · ")}</p>}
              <p className="mt-2 text-sm">{truncate(m.job.description.replace(/\s+/g, " "), 220)}</p>
              <MatchActions jobId={m.jobId} status={m.status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
