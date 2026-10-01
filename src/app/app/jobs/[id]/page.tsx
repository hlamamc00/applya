import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Card, PageHeader } from "@/components/ui";
import { ScoreBadge } from "@/components/status-badge";
import { MatchActions } from "../match-actions";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/app/jobs");
  const { id } = await params;
  const job = await db.job.findUnique({ where: { id }, include: { source: true } });
  if (!job) notFound();
  const [match, application] = await Promise.all([
    db.match.findUnique({ where: { userId_jobId: { userId: user.id, jobId: job.id } } }),
    db.application.findUnique({ where: { userId_jobId: { userId: user.id, jobId: job.id } }, select: { id: true } }),
  ]);

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/app/jobs" className="text-graphite">
          ← Matches
        </Link>
      </p>
      <PageHeader
        eyebrow={job.company}
        title={job.title}
        intro={
          <>
            {[job.location, job.remote ? "Remote" : "", job.salary].filter(Boolean).join(" · ")}
            {job.postedAt ? ` · posted ${formatDate(job.postedAt)}` : ""}
            {job.closedAt ? " · no longer listed" : ""}
          </>
        }
        action={match ? <ScoreBadge score={match.score} /> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{job.description || "The advert has no description; open the listing."}</div>
        </Card>
        <div className="space-y-4">
          <Card>
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold">
              Open the listing <ExternalLink size={15} />
            </a>
            <p className="mt-1 text-xs text-graphite">Via {job.source.name}</p>
            {match && Array.isArray(match.reasons) && (
              <ul className="mt-4 space-y-1 text-sm text-graphite">
                {(match.reasons as string[]).map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            )}
            <MatchActions jobId={job.id} status={match?.status ?? "NEW"} applicationId={application?.id} />
          </Card>
        </div>
      </div>
    </>
  );
}
