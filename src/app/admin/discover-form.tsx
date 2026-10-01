"use client";

import { useActionState } from "react";
import { Compass } from "lucide-react";
import { adminDiscover } from "@/lib/actions/admin";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Field, Notice } from "@/components/ui";

export function DiscoverForm() {
  const [state, action] = useActionState<FormState, FormData>(adminDiscover, {});
  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-graphite">Adds a reed.co.uk search per keyword, and, with web discovery on, employers&apos; Greenhouse / Lever / Ashby / Workable boards and specialist job-board feeds found by searching the web. Every candidate is tried first; only ones that return adverts are added.</p>
      <Field label="Field" hint="e.g. actuarial, data engineering, physiotherapy">
        <input className="input" name="field" required />
      </Field>
      <Field label="Keywords for searches" hint="Comma-separated; defaults to the field.">
        <input className="input" name="keywords" placeholder="actuarial, actuary, trainee actuary" />
      </Field>
      <Field label="Where" hint="Blank = United Kingdom.">
        <input className="input" name="where" placeholder="London" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="web" defaultChecked /> Search the web for employer boards and feeds (needs ANTHROPIC_API_KEY or BRAVE_SEARCH_API_KEY)
      </label>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <SubmitButton pending="Searching… this can take a minute or two">
        <Compass size={15} /> Find sources
      </SubmitButton>
    </form>
  );
}
