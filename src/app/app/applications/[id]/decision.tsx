"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ExternalLink, Globe, Mail, Send } from "lucide-react";
import { applyOnSite, approve, sendByEmail, setStatus } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, Notice } from "@/components/ui";
import { LiveStatus } from "@/components/live-status";
import { QuestionsForm, type OpenQuestion } from "./questions-form";

export interface DecisionProps {
  applicationId: string;
  status: string;
  cvVersionId: string | null;
  jobUrl: string;
  applyEmail: string | null;
  canApplyOnSite: boolean;
  mailbox: string | null;
  subject: string;
  approvedLine: string | null;
  submittedLine: string | null;
  latest: { status: string; detail: string; finalUrl: string | null; screenshotUrl: string | null; mode: string; finishedAt: string | null; questions: OpenQuestion[] } | null;
}

/** The right-hand card: approve, and send by email or apply on the site. */
export function Decision(p: DecisionProps) {
  const [send, sendAction] = useActionState<FormState, FormData>(sendByEmail, {});
  const [site, siteAction] = useActionState<FormState, FormData>(applyOnSite, {});
  const reviewing = p.status === "IN_REVIEW" || p.status === "DRAFT";
  const emailReady = Boolean(p.applyEmail && p.mailbox);

  if (reviewing) {
    return (
      <>
        <p className="mb-3 text-sm text-graphite">Read the CV and message above. Approving records this exact CV version.</p>
        <div className="grid gap-2">
          {emailReady && (
            <form action={approve}>
              <input type="hidden" name="id" value={p.applicationId} />
              <input type="hidden" name="cvVersionId" value={p.cvVersionId ?? ""} />
              <input type="hidden" name="then" value="email" />
              <SubmitButton variant="green" className="w-full" disabled={!p.cvVersionId} pending="Sending…">
                <Mail size={15} /> Approve & send to {p.applyEmail}
              </SubmitButton>
            </form>
          )}
          {p.applyEmail && !p.mailbox && (
            <Notice tone="neutral">
              The advert asks for applications at <strong>{p.applyEmail}</strong>. <Link href="/app/settings" className="font-semibold underline">Connect your mailbox</Link> to send from your address on approval.
            </Notice>
          )}
          {!p.applyEmail && p.canApplyOnSite && (
            <form action={approve}>
              <input type="hidden" name="id" value={p.applicationId} />
              <input type="hidden" name="cvVersionId" value={p.cvVersionId ?? ""} />
              <input type="hidden" name="then" value="site" />
              <SubmitButton variant="green" className="w-full" disabled={!p.cvVersionId} pending="Starting…">
                <Globe size={15} /> Approve & apply on their site
              </SubmitButton>
            </form>
          )}
          <form action={approve}>
            <input type="hidden" name="id" value={p.applicationId} />
            <input type="hidden" name="cvVersionId" value={p.cvVersionId ?? ""} />
            <SubmitButton variant={emailReady || (!p.applyEmail && p.canApplyOnSite) ? "secondary" : "green"} className="w-full" disabled={!p.cvVersionId}>
              Approve only
            </SubmitButton>
          </form>
        </div>
        {!p.applyEmail && p.canApplyOnSite && (
          <p className="mt-3 text-xs text-graphite">&ldquo;Apply on their site&rdquo; opens the employer&apos;s form in a browser, fills it in from your profile, attaches the CV and submits it. If the site wants an account or a CAPTCHA, it stops and shows you where it got to.</p>
        )}
      </>
    );
  }

  const working = p.status === "SUBMITTING" || p.latest?.status === "QUEUED" || p.latest?.status === "RUNNING" || Boolean(site.ok) || Boolean(send.ok);
  const live = <LiveStatus url={`/app/applications/${p.applicationId}/status`} active={working} label="Working on it in the background…" className="mt-2" />;

  if (p.status === "SUBMITTING") {
    return (
      <>
        <Notice tone="blue">Applying on the employer&apos;s site now. This takes a minute or two; the result appears here when it&apos;s done.</Notice>
        {live}
      </>
    );
  }

  if (p.status === "APPROVED" || p.status === "NEEDS_YOU") {
    return (
      <>
        {p.approvedLine && <Notice tone="blue">{p.approvedLine}</Notice>}
        {p.status === "NEEDS_YOU" && p.latest && (
          <div className="mt-3 rounded-lg border border-amber/40 bg-amber-soft p-3 text-sm">
            <p className="font-semibold">{/additional information/i.test(p.latest.detail) ? p.latest.detail : `Needs you: ${p.latest.detail}`}</p>
            {/additional information/i.test(p.latest.detail) && p.latest.questions.length === 0 && (
              <p className="mt-1 text-xs text-graphite">Add the missing details to your <Link href="/app/profile" className="underline">profile</Link> and press &ldquo;Apply on their site now&rdquo; again, or answer on the site yourself.</p>
            )}
            {p.latest.finalUrl && (
              <a href={p.latest.finalUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 underline">
                Open where it stopped <ExternalLink size={13} />
              </a>
            )}
            {p.latest.screenshotUrl && (
              <a href={p.latest.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.latest.screenshotUrl} alt="Screenshot of the employer's form" className="max-h-64 w-full rounded border border-mist object-cover object-top" />
              </a>
            )}
          </div>
        )}
        {p.latest && p.latest.questions.length > 0 && (p.latest.status === "NEEDS_YOU" || p.latest.status === "PREVIEWED") && !working && (
          <QuestionsForm applicationId={p.applicationId} questions={p.latest.questions} previewMode={p.latest.mode === "PREVIEW"} />
        )}
        {p.latest?.mode === "PREVIEW" && p.latest.status === "PREVIEWED" && p.latest.screenshotUrl && (
          <div className="mt-3 rounded-lg border border-mist bg-cloud p-3 text-sm">
            <p className="font-semibold">Preview: the form filled in, not submitted</p>
            <a href={p.latest.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.latest.screenshotUrl} alt="Preview of the filled-in form" className="max-h-64 w-full rounded border border-mist object-cover object-top" />
            </a>
          </div>
        )}

        <div className="mt-3 space-y-3">
          {p.mailbox ? (
            <form action={sendAction} className="space-y-2 rounded-lg border border-mist bg-cloud/60 p-3">
              <input type="hidden" name="id" value={p.applicationId} />
              <p className="text-sm">
                Send from <strong>{p.mailbox}</strong> with the approved CV attached.
              </p>
              <Field label="To">
                <input className="input" type="email" name="to" defaultValue={p.applyEmail ?? ""} placeholder="careers@employer.co.uk" required />
              </Field>
              <Field label="Subject">
                <input className="input" name="subject" defaultValue={p.subject} required maxLength={200} />
              </Field>
              {send.error && <Notice tone="red">{send.error}</Notice>}
              {send.ok && <Notice tone="green">{send.ok}</Notice>}
              <SubmitButton variant="green" className="w-full" pending="Sending…">
                <Send size={15} /> Send application by email
              </SubmitButton>
            </form>
          ) : (
            <Notice tone="neutral">
              To send by email from your own address, <Link href="/app/settings" className="font-semibold underline">connect your mailbox</Link> under Account.
            </Notice>
          )}

          {p.canApplyOnSite && (
            <div className="space-y-2 rounded-lg border border-mist bg-cloud/60 p-3">
              <p className="text-sm">Or let the browser fill in and submit the employer&apos;s form.</p>
              {site.error && <Notice tone="red">{site.error}</Notice>}
              {site.ok && <Notice tone="green">{site.ok}</Notice>}
              {live}
              <div className="grid gap-2">
                <form action={siteAction}>
                  <input type="hidden" name="id" value={p.applicationId} />
                  <input type="hidden" name="mode" value="LIVE" />
                  <SubmitButton variant="green" className="w-full" pending="Starting…">
                    <Globe size={15} /> Apply on their site now
                  </SubmitButton>
                </form>
                <form action={siteAction}>
                  <input type="hidden" name="id" value={p.applicationId} />
                  <input type="hidden" name="mode" value="PREVIEW" />
                  <SubmitButton variant="secondary" className="w-full" pending="Starting…">
                    Preview the filled-in form first
                  </SubmitButton>
                </form>
              </div>
            </div>
          )}

          <a href={p.jobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-mist bg-white px-4 py-2 text-sm font-semibold hover:bg-cloud">
            Open application page <ExternalLink size={14} />
          </a>
          <form action={setStatus}>
            <input type="hidden" name="id" value={p.applicationId} />
            <input type="hidden" name="status" value="SUBMITTED" />
            <input type="hidden" name="via" value="LINK" />
            <SubmitButton variant="secondary" className="w-full">
              I applied myself: mark as submitted
            </SubmitButton>
          </form>
          <form action={setStatus}>
            <input type="hidden" name="id" value={p.applicationId} />
            <input type="hidden" name="status" value="IN_REVIEW" />
            <Button type="submit" variant="ghost" className="w-full">
              Remove approval
            </Button>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-graphite">{p.submittedLine}</p>
      {p.latest?.screenshotUrl && p.status === "SUBMITTED" && (
        <a href={p.latest.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block text-sm underline">
          Screenshot of the submitted form
        </a>
      )}
      <div className="mt-3 grid gap-2">
        {p.status === "WITHDRAWN" && (
          <form action={setStatus}>
            <input type="hidden" name="id" value={p.applicationId} />
            <input type="hidden" name="status" value="IN_REVIEW" />
            <SubmitButton variant="green" className="w-full" pending="Reopening…">
              Re-apply: reopen for review
            </SubmitButton>
          </form>
        )}
        {p.status === "WITHDRAWN" && <p className="text-xs text-graphite">Reopening puts the application back in review with its CV and message as they were; approve it again to send or apply.</p>}
        {(["INTERVIEW", "OFFER", "REJECTED"] as const)
          .filter((s) => s !== p.status && p.status !== "WITHDRAWN")
          .map((s) => (
            <form key={s} action={setStatus}>
              <input type="hidden" name="id" value={p.applicationId} />
              <input type="hidden" name="status" value={s} />
              <SubmitButton variant="secondary" className="w-full">
                {s === "INTERVIEW" ? "Interview arranged" : s === "OFFER" ? "Offer received" : "Rejected"}
              </SubmitButton>
            </form>
          ))}
      </div>
    </>
  );
}
