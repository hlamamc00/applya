"use client";

import { useActionState } from "react";
import { saveMessage } from "@/lib/actions/applications";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

export function MessageForm({ applicationId, coverMessage, notes }: { applicationId: string; coverMessage: string; notes: string }) {
  const [state, action] = useActionState<FormState, FormData>(saveMessage, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={applicationId} />
      <Field label="Message to the employer" hint="Paste this into the application form or email. Editing an approved message needs a new approval.">
        <textarea className="textarea font-sans" name="coverMessage" rows={12} defaultValue={coverMessage} />
      </Field>
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
