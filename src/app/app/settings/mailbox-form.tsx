"use client";

import { useActionState, useState } from "react";
import { connectMailbox, disconnectMailbox, sendTestEmail } from "@/lib/actions/mail-account";
import type { FormState } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, Notice } from "@/components/ui";

const presets = [
  { key: "gmail", label: "Gmail / Google Workspace", help: "Turn on 2-step verification, then create an app password at myaccount.google.com/apppasswords and paste it below." },
  { key: "outlook", label: "Outlook / Hotmail / Microsoft 365", help: "Turn on two-step verification at account.microsoft.com → Security, then create an app password under Advanced security options and paste it below." },
  { key: "yahoo", label: "Yahoo", help: "Create an app password under Account security." },
  { key: "icloud", label: "iCloud", help: "Create an app-specific password at appleid.apple.com." },
  { key: "other", label: "Other (enter SMTP details)", help: "Your provider's SMTP host, port and login." },
];

interface Connected {
  kind: string;
  fromEmail: string;
  fromName: string;
  host: string | null;
  verifiedAt: string;
  lastError: string | null;
}

interface OAuthOptions {
  google: boolean;
  microsoft: boolean;
}

const kindLabel: Record<string, string> = { GMAIL: "Gmail", OUTLOOK: "Outlook", SMTP: "SMTP" };

export function MailboxForm({ connected, defaultEmail, defaultName, oauth, notice }: { connected: Connected | null; defaultEmail: string; defaultName: string; oauth: OAuthOptions; notice: { tone: "green" | "red" | "amber"; text: string } | null }) {
  const [state, action] = useActionState<FormState, FormData>(connectMailbox, {});
  const [test, testAction] = useActionState<FormState, FormData>(async () => sendTestEmail(), {});
  const [preset, setPreset] = useState("gmail");
  const [showSmtp, setShowSmtp] = useState(!oauth.google && !oauth.microsoft);
  const chosen = presets.find((p) => p.key === preset)!;

  if (connected) {
    return (
      <div className="space-y-3">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <Notice tone="green">
          Applications are sent from <strong>{connected.fromName ? `${connected.fromName} <${connected.fromEmail}>` : connected.fromEmail}</strong> via {connected.kind === "SMTP" ? connected.host : kindLabel[connected.kind]}. Connected {connected.verifiedAt}.
        </Notice>
        {connected.lastError && <Notice tone="red">Last send failed: {connected.lastError}</Notice>}
        {test.ok && <Notice tone="green">{test.ok}</Notice>}
        {test.error && <Notice tone="red">{test.error}</Notice>}
        <div className="flex flex-wrap gap-2">
          <form action={testAction}>
            <SubmitButton variant="secondary" pending="Sending…">
              Send me a test email
            </SubmitButton>
          </form>
          <form action={disconnectMailbox}>
            <Button type="submit" variant="danger">
              Disconnect
            </Button>
          </form>
        </div>
        <p className="text-xs text-graphite">
          {connected.kind === "SMTP" ? "The app password is stored encrypted." : `Applya holds only permission to send; it cannot read your ${kindLabel[connected.kind]} inbox. You can also revoke it from your ${connected.kind === "GMAIL" ? "Google" : "Microsoft"} account's connected apps.`} Disconnecting deletes the stored credentials; messages already sent stay in your Sent folder.
        </p>
      </div>
    );
  }

  const oauthButtons = (oauth.google || oauth.microsoft) && (
    <div className="space-y-3">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <p className="text-sm text-graphite">Connect your own mailbox so approved applications go to employers from your address, with the CV attached, and appear in your Sent folder. Applya asks only for permission to send.</p>
      <div className="flex flex-wrap gap-2">
        {oauth.google && (
          <a href="/api/mail/google/start" className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-soft">
            Connect Gmail
          </a>
        )}
        {oauth.microsoft && (
          <a href="/api/mail/microsoft/start" className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-soft">
            Connect Outlook
          </a>
        )}
        <Button type="button" variant="ghost" onClick={() => setShowSmtp((v) => !v)}>
          {showSmtp ? "Hide" : "Another provider (SMTP)"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {oauthButtons}
      {showSmtp && (
    <form action={action} className="space-y-4">
      {!oauthButtons && <p className="text-sm text-graphite">Connect your own mailbox so approved applications go to employers from your address, with the CV attached, and appear in your Sent folder.</p>}
      <Field label="Provider">
        <select className="select" name="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="hint">{chosen.help}</span>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your email address">
          <input className="input" type="email" name="fromEmail" defaultValue={defaultEmail} required />
        </Field>
        <Field label="Name shown to employers">
          <input className="input" name="fromName" defaultValue={defaultName} />
        </Field>
      </div>
      {preset === "other" && (
        <div className="grid gap-4 sm:grid-cols-[1fr_120px_1fr]">
          <Field label="SMTP host">
            <input className="input" name="host" placeholder="smtp.example.com" />
          </Field>
          <Field label="Port">
            <input className="input" type="number" name="port" defaultValue={587} />
          </Field>
          <Field label="Login (if not the email)">
            <input className="input" name="username" />
          </Field>
        </div>
      )}
      <Field label="App password" hint="Not your normal password: an app password from your provider's security settings. Stored encrypted.">
        <input className="input" type="password" name="password" autoComplete="off" required />
      </Field>
      {state.error && <Notice tone="red">{state.error}</Notice>}
      {state.ok && <Notice tone="green">{state.ok}</Notice>}
      <SubmitButton pending="Checking the login…">Connect mailbox</SubmitButton>
    </form>
      )}
    </div>
  );
}
