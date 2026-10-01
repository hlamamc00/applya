import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isProfileUsable } from "@/lib/cv";
import { formatDate } from "@/lib/utils";
import { ButtonLink, Card, CardTitle, Empty, Notice, PageHeader } from "@/components/ui";
import { ScoreBadge, StatusBadge } from "@/components/status-badge";

export default async function OverviewPage() {
  const user = await requireUser();
  const [profile, prefs, review, approved, submitted, matches, recent, lastRun, sourceCount] = await Promise.all([
    db.profile.findUnique({ where: { userId: user.id } }),
    db.preference.findUnique({ where: { userId: user.id } }),
    db.application.count({ where: { userId: user.id, status: "IN_REVIEW" } }),
    db.application.count({ where: { userId: user.id, status: "APPROVED" } }),
    db.application.count({ where: { userId: user.id, status: { in: ["SUBMITTED", "INTERVIEW", "OFFER"] } } }),
    db.match.count({ where: { userId: user.id, status: "NEW", job: { closedAt: null } } }),
    db.application.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 6, include: { job: true } }),
    db.scanRun.findFirst({ where: { finishedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
    db.jobSource.count({ where: { enabled: true } }),
  ]);
  const topMatches = await db.match.findMany({
    where: { userId: user.id, status: "NEW", job: { closedAt: null } },
    orderBy: { score: "desc" },
    take: 5,
    include: { job: true },
  });
  const profileReady = isProfileUsable(profile);
  const prefsReady = Boolean(prefs && Array.isArray(prefs.keywords) && prefs.keywords.length > 0);

  return (
    <>
      <PageHeader eyebrow="Overview" title={`Good to see you, ${user.firstName}`} intro={lastRun ? `Last scan ${formatDate(lastRun.startedAt, "d MMM, HH:mm")}: ${lastRun.jobsFound} adverts read across ${sourceCount} sources.` : "No scan has run yet."} />

      {(!profileReady || !prefsReady) && (
        <div className="mb-6 space-y-3">
          {!profileReady && (
            <Notice tone="amber">
              Your profile needs a summary and at least one role or qualification before drafts can be prepared. <Link href="/app/profile" className="font-semibold">Complete your profile →</Link>
            </Notice>
          )}
          {!prefsReady && (
            <Notice tone="amber">
              Add a few keywords so the scanner knows what to look for. <Link href="/app/preferences" className="font-semibold">Set job preferences →</Link>
            </Notice>
          )}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Ready to review", value: review, href: "/app/applications?status=IN_REVIEW" },
          { label: "Approved, not yet sent", value: approved, href: "/app/applications?status=APPROVED" },
          { label: "Submitted", value: submitted, href: "/app/applications?status=SUBMITTED" },
          { label: "New matches", value: matches, href: "/app/jobs" },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border border-mist bg-white p-5 transition-colors hover:border-green">
            <p className="text-sm text-graphite">{s.label}</p>
            <p className="mt-1 font-serif text-4xl">{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle action={<Link href="/app/applications" className="text-sm text-graphite">All applications</Link>}>Recent applications</CardTitle>
          {recent.length === 0 ? (
            <Empty title="No applications yet">Drafts appear here once the scanner finds a strong match, or when you prepare one from a job.</Empty>
          ) : (
            <ul className="divide-y divide-cloud">
              {recent.map((a) => (
                <li key={a.id} className="py-3">
                  <Link href={`/app/applications/${a.id}`} className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-semibold">{a.job.title}</span>
                      <span className="block text-sm text-graphite">
                        {a.job.company} · {formatDate(a.updatedAt)}
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle action={<Link href="/app/jobs" className="text-sm text-graphite">All matches</Link>}>Strongest new matches</CardTitle>
          {topMatches.length === 0 ? (
            <Empty title="Nothing to show yet">
              <p>Run a scan from the Matches page once your preferences are set.</p>
              <ButtonLink href="/app/jobs" variant="secondary" className="mt-3">
                Go to matches
              </ButtonLink>
            </Empty>
          ) : (
            <ul className="divide-y divide-cloud">
              {topMatches.map((m) => (
                <li key={m.id} className="py-3">
                  <Link href={`/app/jobs/${m.jobId}`} className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-semibold">{m.job.title}</span>
                      <span className="block text-sm text-graphite">
                        {m.job.company}
                        {m.job.location ? ` · ${m.job.location}` : ""}
                      </span>
                    </span>
                    <ScoreBadge score={m.score} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
