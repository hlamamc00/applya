"use client";

import { useActionState, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { saveMessage } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

export function MessageForm({ applicationId, coverMessage, notes }: { applicationId: string; coverMessage: string; notes: string }) {
  const [state, action] = useActionState<FormState, FormData>(saveMessage, {});
  const [message, setMessage] = useState(coverMessage);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={applicationId} />
      <div className="relative">
        <Field label="Message to the employer" hint="Paste this into the application form or email. Editing an approved message needs a new approval.">
          <textarea className="textarea font-sans" name="coverMessage" rows={12} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <CopyButton text={message} label="Copy message" className="absolute right-0 top-0" />
      </div>
      <Field label="Private notes" hint="Only you see these: recruiter name, questions to ask, follow-up dates.">
        <textarea className="textarea" name="notes" rows={3} defaultValue={notes} />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <SubmitButton variant="secondary" pending="Saving…">
        Save
      </SubmitButton>
    </form>
  );
}
