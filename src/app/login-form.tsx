"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email address">
        <input className="input" type="email" name="email" autoComplete="email" required />
      </Field>
      <Field label="Password">
        <PasswordInput name="password" autoComplete="current-password" required minLength={1} maxLength={128} />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      <p className="text-xs text-graphite">
        By using Applya, you agree to our <Link href="/terms">Terms of Service</Link>. Read our <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <div className="flex flex-wrap items-center gap-4 pt-2">
        <SubmitButton pending="Signing in…">Sign in</SubmitButton>
        <Link href="/forgot-password" className="text-sm text-graphite">
          Forgotten your password?
        </Link>
      </div>
      <p className="pt-2 text-sm">
        <Link href="/register" className="font-semibold text-[#365f59] underline">
          New to Applya? Create an account
        </Link>
      </p>
    </form>
  );
}
