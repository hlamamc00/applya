import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseCv } from "@/lib/cv";
import { latestCv } from "@/lib/applications";
import { approve, deleteApplication, retailor, setStatus } from "@/lib/actions/applications";
import { fileSafeName, formatDate, formatDateTime } from "@/lib/utils";
import { Button, Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { CvPreview } from "./cv-preview";
import { CvEditor } from "./cv-editor";
import { MessageForm } from "./message-form";
import { SendForm } from "./send-form";

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
  // An address in the advert is the likely place to apply.
  const advertEmail = app.applyEmail ?? /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(app.job.description)?.[0] ?? "";

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
            <MessageForm applicationId={app.id} coverMessage={app.coverMessage} notes={app.notes} />
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
            {app.status === "IN_REVIEW" || app.status === "DRAFT" ? (
              <>
                <p className="mb-3 text-sm text-graphite">Read the CV and message above. Approving records this exact CV version; nothing is sent until you mark it submitted.</p>
                <form action={approve}>
                  <input type="hidden" name="id" value={app.id} />
                  <input type="hidden" name="cvVersionId" value={version?.id ?? ""} />
                  <SubmitButton variant="green" className="w-full" disabled={!version}>
                    Approve this version
                  </SubmitButton>
                </form>
              </>
            ) : app.status === "APPROVED" ? (
              <>
                <Notice tone="blue">
                  Approved {formatDate(app.approvedAt)} · version “{app.approvedCv?.label}”{approvedIsLatest ? "" : " (an older version)"}
                </Notice>
                <SendForm applicationId={app.id} defaultTo={advertEmail} defaultSubject={`Application: ${app.job.title} – ${user.firstName} ${user.lastName}`} mailbox={mailbox?.fromEmail ?? null} />
                <p className="my-3 text-sm text-graphite">Or apply on the employer&apos;s site with the downloaded CV and message, then mark it submitted here.</p>
                <a href={app.job.url} target="_blank" rel="noopener noreferrer" className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-mist bg-white px-4 py-2 text-sm font-semibold hover:bg-cloud">
                  Open application page <ExternalLink size={14} />
                </a>
                <form action={setStatus} className="mb-2">
                  <input type="hidden" name="id" value={app.id} />
                  <input type="hidden" name="status" value="SUBMITTED" />
                  <input type="hidden" name="via" value="LINK" />
                  <SubmitButton variant="secondary" className="w-full">
                    Mark as submitted on their site
                  </SubmitButton>
                </form>
                <form action={setStatus}>
                  <input type="hidden" name="id" value={app.id} />
                  <input type="hidden" name="status" value="IN_REVIEW" />
                  <SubmitButton variant="ghost" className="w-full">
                    Remove approval
                  </SubmitButton>
                </form>
              </>
            ) : (
              <>
                <p className="text-sm text-graphite">
                  {app.status === "SUBMITTED" && `Submitted ${formatDate(app.submittedAt)}${app.submittedVia === "EMAIL" && app.sentTo ? ` by email to ${app.sentTo}` : ""}.`}
                  {app.status === "INTERVIEW" && "Interview stage."}
                  {app.status === "OFFER" && "Offer received."}
                  {app.status === "REJECTED" && "Rejected."}
                  {app.status === "WITHDRAWN" && "Withdrawn."}
                </p>
                <div className="mt-3 grid gap-2">
                  {(["INTERVIEW", "OFFER", "REJECTED"] as const)
                    .filter((s) => s !== app.status && app.status !== "WITHDRAWN")
                    .map((s) => (
                      <form key={s} action={setStatus}>
                        <input type="hidden" name="id" value={app.id} />
                        <input type="hidden" name="status" value={s} />
                        <SubmitButton variant="secondary" className="w-full">
                          {s === "INTERVIEW" ? "Interview arranged" : s === "OFFER" ? "Offer received" : "Rejected"}
                        </SubmitButton>
                      </form>
                    ))}
                </div>
              </>
            )}
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
