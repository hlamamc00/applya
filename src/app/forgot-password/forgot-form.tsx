"use client";

import { useActionState } from "react";
import { requestPasswordReset, type FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

export function ForgotForm() {
  const [state, action] = useActionState<FormState, FormData>(requestPasswordReset, {});
  if (state.ok) return <Notice tone="green">{state.ok}</Notice>;
  return (
    <form action={action} className="space-y-4">
      <Field label="Email address">
        <input className="input" type="email" name="email" autoComplete="email" required />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      <SubmitButton pending="Sending…">Send reset link</SubmitButton>
    </form>
  );
}
