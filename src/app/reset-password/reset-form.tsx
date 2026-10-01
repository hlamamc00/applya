"use client";

import { useActionState } from "react";
import { resetPassword, type FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

export function ResetForm({ uid, token }: { uid: string; token: string }) {
  const [state, action] = useActionState<FormState, FormData>(resetPassword, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="uid" value={uid} />
      <input type="hidden" name="token" value={token} />
      <Field label="New password" hint="At least 8 characters with a number.">
        <input className="input" type="password" name="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      <SubmitButton pending="Saving…">Save password and sign in</SubmitButton>
    </form>
  );
}
