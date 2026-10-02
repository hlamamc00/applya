"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/actions/account";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function PasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Current password">
        <PasswordInput name="current" autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="At least 8 characters with a number.">
        <PasswordInput name="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <SubmitButton pending="Saving…">Change password</SubmitButton>
    </form>
  );
}
