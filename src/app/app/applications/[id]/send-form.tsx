"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Send } from "lucide-react";
import { sendByEmail } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

/** "Approve & send": the approved CV and message, from the user's own mailbox. */
export function SendForm({ applicationId, defaultTo, defaultSubject, mailbox }: { applicationId: string; defaultTo: string; defaultSubject: string; mailbox: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(sendByEmail, {});
  if (!mailbox) {
    return (
      <Notice tone="neutral">
        To send this by email from your own address, <Link href="/app/settings" className="font-semibold underline">connect your mailbox</Link> under Account.
      </Notice>
    );
  }
  return (
    <form action={action} className="space-y-3 rounded-lg border border-mist bg-cloud/60 p-3">
      <input type="hidden" name="id" value={applicationId} />
      <p className="text-sm">
        Send from <strong>{mailbox}</strong> with the approved CV attached and the message as the email body.
      </p>
      <Field label="To (employer or recruiter)">
        <input className="input" type="email" name="to" defaultValue={defaultTo} placeholder="careers@employer.co.uk" required />
      </Field>
      <Field label="Subject">
        <input className="input" name="subject" defaultValue={defaultSubject} required maxLength={200} />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <SubmitButton variant="green" className="w-full" pending="Sending…">
        <Send size={15} /> Send application by email
      </SubmitButton>
      <p className="text-xs text-graphite">Check the address: once sent, an application can&apos;t be recalled. Only approve-then-send is possible; the version sent is the one you approved.</p>
    </form>
  );
}
