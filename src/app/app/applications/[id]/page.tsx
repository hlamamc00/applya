import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseCv } from "@/lib/cv";
import { latestCv } from "@/lib/applications";
import { deleteApplication, retailor, setStatus } from "@/lib/actions/applications";
import { applyEmailFor, canApplyOnSite } from "@/lib/apply";
import { fileSafeName, formatDate, formatDateTime } from "@/lib/utils";
import { Button, Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { CvPreview } from "./cv-preview";
import { CvEditor } from "./cv-editor";
import { MessageForm } from "./message-form";
import { Decision } from "./decision";
import type { OpenQuestion } from "./questions-form";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stale?: string; edit?: string }> }) {
  const user = await requireUser("/app/applications");
  const { id } = await params;
  const { stale, edit } = await searchParams;
  const app = await db.application.findFirst({
    where: { id, userId: user.id },
    include: { job: { include: { source: true } }, events: { orderBy: { createdAt: "asc" } }, cvVersions: { orderBy: { createdAt: "desc" } }, approvedCv: true },
  });
  if (!app) notFound();
  const version = await latestCv(app.id);
  const cv = version ? parseCv(version.content) : null;
  const fileName = `${fileSafeName(user.firstName, user.lastName)}_CV.pdf`;
  const approvedIsLatest = app.approvedCvId && version && app.approvedCvId === version.id;
  const mailbox = await db.mailAccount.findUnique({ where: { userId: user.id }, select: { fromEmail: true } });
  const advertEmail = applyEmailFor(app.job, app);
  const latestAttempt = await db.applicationAttempt.findFirst({ where: { applicationId: app.id, kind: "FORM" }, orderBy: { startedAt: "desc" }, select: { id: true, status: true, detail: true, finalUrl: true, mode: true, finishedAt: true, screenshot: true, questions: true } });

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/app/applications" className="text-graphite">
          ← Applications
        </Link>
      </p>
      <PageHeader eyebrow={app.job.company} title={app.job.title} intro={[app.job.location, app.job.remote ? "Remote" : "", app.job.salary].filter(Boolean).join(" · ")} action={<StatusBadge status={app.status} />} />

      {stale && (
        <div className="mb-4">
          <Notice tone="amber">The CV changed while you were reviewing. Read the current version below, then approve.</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardTitle
              action={
                <div className="flex flex-wrap gap-2">
                  {version && (
                    <a href={`/app/applications/${app.id}/cv.pdf`} className="inline-flex items-center gap-1.5 rounded-md border border-mist bg-white px-3 py-1.5 text-sm font-semibold hover:bg-cloud">
                      <Download size={14} /> {fileName}
                    </a>
                  )}
                  {!edit && (
                    <Link href={`/app/applications/${app.id}?edit=1`} className="inline-flex items-center rounded-md border border-mist bg-white px-3 py-1.5 text-sm font-semibold hover:bg-cloud">
                      Edit CV
                    </Link>
                  )}
                </div>
              }
            >
              Tailored CV
            </CardTitle>
            {version && (
              <p className="mb-4 text-xs text-graphite">
                Version “{version.label}” · {version.method === "AI" ? "AI tailoring" : version.method === "HEURISTIC" ? "keyword tailoring" : "edited by you"} · {formatDateTime(version.createdAt)}
                {app.cvVersions.length > 1 ? ` · ${app.cvVersions.length} versions` : ""}
              </p>
            )}
            {!cv ? <p className="text-sm text-graphite">No CV yet.</p> : edit ? <CvEditor applicationId={app.id} initial={cv} /> : <CvPreview cv={cv} />}
          </Card>

          <Card>
            <CardTitle>Cover message</CardTitle>
            <MessageForm key={`${app.updatedAt.toISOString()}:${app.coverMessage.length}`} applicationId={app.id} coverMessage={app.coverMessage} notes={app.notes} />
          </Card>

          <Card>
            <CardTitle>The advert</CardTitle>
            <a href={app.job.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold">
              Open the listing on {app.job.source.name} <ExternalLink size={14} />
            </a>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-graphite">Show the full advert</summary>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{app.job.description}</div>
            </details>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Decision</CardTitle>
            <Decision
              applicationId={app.id}
              status={app.status}
              cvVersionId={version?.id ?? null}
              jobUrl={app.job.applyUrl || app.job.url}
              applyEmail={advertEmail}
              canApplyOnSite={canApplyOnSite(app.job)}
              mailbox={mailbox?.fromEmail ?? null}
              subject={`Application: ${app.job.title} – ${user.firstName} ${user.lastName}`}
              approvedLine={app.approvedAt ? `Approved ${formatDate(app.approvedAt)} · version “${app.approvedCv?.label}”${approvedIsLatest ? "" : " (an older version)"}` : null}
              submittedLine={
                app.status === "SUBMITTED"
                  ? `Submitted ${formatDate(app.submittedAt)}${app.submittedVia === "EMAIL" && app.sentTo ? ` by email to ${app.sentTo}` : app.submittedVia === "FORM" ? " on the employer's site" : ""}.`
                  : app.status === "INTERVIEW"
                    ? "Interview stage."
                    : app.status === "OFFER"
                      ? "Offer received."
                      : app.status === "REJECTED"
                        ? "Rejected."
                        : app.status === "WITHDRAWN"
                          ? "Withdrawn."
                          : null
              }
              latest={
                latestAttempt
                  ? { status: latestAttempt.status, detail: latestAttempt.detail, finalUrl: latestAttempt.finalUrl, mode: latestAttempt.mode, finishedAt: latestAttempt.finishedAt?.toISOString() ?? null, questions: Array.isArray(latestAttempt.questions) ? (latestAttempt.questions as unknown as OpenQuestion[]) : [], screenshotUrl: latestAttempt.screenshot ? `/app/applications/${app.id}/attempts/${latestAttempt.id}/screenshot.jpg` : null }
                  : null
              }
            />
          </Card>

          <Card>
            <CardTitle>More</CardTitle>
            <div className="grid gap-2">
              <form action={retailor}>
                <input type="hidden" name="id" value={app.id} />
                <SubmitButton variant="secondary" className="w-full" pending="Tailoring…">
                  Re-tailor from my profile
                </SubmitButton>
              </form>
              {!["SUBMITTED", "INTERVIEW", "OFFER", "WITHDRAWN"].includes(app.status) && (
                <form action={setStatus}>
                  <input type="hidden" name="id" value={app.id} />
                  <input type="hidden" name="status" value="WITHDRAWN" />
                  <Button type="submit" variant="ghost" className="w-full">
                    Withdraw
                  </Button>
                </form>
              )}
              {["DRAFT", "IN_REVIEW", "WITHDRAWN"].includes(app.status) && (
                <form action={deleteApplication}>
                  <input type="hidden" name="id" value={app.id} />
                  <Button type="submit" variant="danger" className="w-full">
                    Delete draft
                  </Button>
                </form>
              )}
            </div>
          </Card>

          <Card>
            <CardTitle>History</CardTitle>
            <ol className="space-y-2 text-sm">
              {app.events.map((e) => (
                <li key={e.id}>
                  <span className="block text-xs text-steel">{formatDateTime(e.createdAt)}</span>
                  {e.detail}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
