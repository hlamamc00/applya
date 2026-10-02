"use client";

import { useActionState, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { removePortalLogin, savePortalLogin } from "@/lib/actions/portal-accounts";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { PasswordInput } from "@/components/password-input";
import { Button, Field, Notice } from "@/components/ui";

export interface PortalLogin {
  id: string;
  host: string;
  username: string;
  lastUsedAt: string | null;
  lastResult: string;
}

/** Logins for job sites that insist on an account before applying. */
export function PortalForm({ logins, portals }: { logins: PortalLogin[]; portals: { host: string; label: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(savePortalLogin, {});
  const [host, setHost] = useState(portals[0]?.host ?? "other");
  return (
    <div className="space-y-4">
      <p className="text-sm text-graphite">
        Some sites (Reed, for one) only let you apply from an account. Save the login here and the browser signs in with it when the site asks, then applies with your Applya CV and message. Passwords are stored encrypted; a site signed up with Google or Apple needs a password set on that site first.
      </p>
      {logins.length > 0 && (
        <ul className="divide-y divide-mist rounded-lg border border-mist">
          {logins.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <p className="font-semibold">{l.host}</p>
                <p className="text-graphite">
                  {l.username}
                  {l.lastUsedAt ? ` · last used ${l.lastUsedAt}` : ""}
                  {l.lastResult ? ` · ${l.lastResult}` : ""}
                </p>
              </div>
              <form action={removePortalLogin}>
                <input type="hidden" name="id" value={l.id} />
                <Button type="submit" variant="ghost" aria-label={`Remove ${l.host} login`}>
                  <Trash2 size={15} />
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={action} className="space-y-3">
        <Field label="Job site">
          <select className="input" name="host" value={host} onChange={(e) => setHost(e.target.value)}>
            {portals.map((p) => (
              <option key={p.host} value={p.host}>
                {p.label} ({p.host})
              </option>
            ))}
            <option value="other">Another site…</option>
          </select>
        </Field>
        {host === "other" && (
          <Field label="Site address">
            <input className="input" name="customHost" placeholder="jobs.example.com" />
          </Field>
        )}
        <Field label="Email or username on that site">
          <input className="input" name="username" autoComplete="off" required />
        </Field>
        <Field label="Password on that site">
          <PasswordInput name="password" autoComplete="off" required />
        </Field>
        {state.error && <Notice tone="red">{state.error}</Notice>}
        {state.ok && <Notice tone="green">{state.ok}</Notice>}
        <SubmitButton variant="secondary" pending="Saving…">
          <KeyRound size={15} /> Save login
        </SubmitButton>
      </form>
    </div>
  );
}
