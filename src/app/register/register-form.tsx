"use client";

import Link from "next/link";
import { useActionState } from "react";
import { register, type FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function RegisterForm() {
  const [state, action] = useActionState<FormState, FormData>(register, {});
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <input className="input" name="firstName" autoComplete="given-name" required maxLength={80} />
        </Field>
        <Field label="Last name">
          <input className="input" name="lastName" autoComplete="family-name" required maxLength={80} />
        </Field>
      </div>
      <Field label="Email address">
        <input className="input" type="email" name="email" autoComplete="email" required />
      </Field>
      <Field label="Password" hint="At least 8 characters with a number.">
        <PasswordInput name="password" autoComplete="new-password" required minLength={8} maxLength={128} />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      <p className="text-xs text-graphite">
        By creating an account you agree to the <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <SubmitButton pending="Creating…">Create account</SubmitButton>
    </form>
  );
}
