import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BRAND } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { PasswordForm } from "./password-form";
import { MailboxForm } from "./mailbox-form";
import { oauthConfigured } from "@/lib/mail-oauth";
import { PORTALS } from "@/lib/portals";
import { PortalForm } from "./portal-form";

export const metadata: Metadata = { title: "Account" };

const mailNotices: Record<string, { tone: "green" | "red" | "amber"; text: string }> = {
  connected: { tone: "green", text: "Mailbox connected." },
  denied: { tone: "amber", text: "Access wasn't granted, so nothing was connected." },
  failed: { tone: "red", text: "The connection didn't complete." },
  invalid: { tone: "red", text: "That link had expired or didn't match your session. Start again from this page." },
  unavailable: { tone: "amber", text: "That provider isn't set up on this site yet." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ mail?: string; email?: string; detail?: string }> }) {
  const user = await requireUser("/app/settings");
  const { mail, email, detail } = await searchParams;
  const mailbox = await db.mailAccount.findUnique({ where: { userId: user.id } });
  const portals = await db.portalAccount.findMany({ where: { userId: user.id }, orderBy: { host: "asc" } });
  const base = mail ? mailNotices[mail] : null;
  const notice = base ? { ...base, text: `${base.text}${mail === "connected" && email ? ` Applications will be sent from ${email}.` : ""}${detail ? ` ${detail}` : ""}` } : null;
  return (
    <>
      <PageHeader eyebrow="Account" title="Account settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardTitle>Your mailbox</CardTitle>
          <MailboxForm
            connected={mailbox ? { kind: mailbox.kind, fromEmail: mailbox.fromEmail, fromName: mailbox.fromName, host: mailbox.host, verifiedAt: formatDateTime(mailbox.verifiedAt), lastError: mailbox.lastError } : null}
            defaultEmail={user.email}
            defaultName={`${user.firstName} ${user.lastName}`}
            oauth={{ google: oauthConfigured("google"), microsoft: oauthConfigured("microsoft") }}
            notice={notice}
          />
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle>Job site logins</CardTitle>
          <PortalForm logins={portals.map((p) => ({ id: p.id, host: p.host, username: p.username, lastUsedAt: p.lastUsedAt ? formatDateTime(p.lastUsedAt) : null, lastResult: p.lastResult }))} portals={PORTALS} />
        </Card>
        <Card>
          <CardTitle>Sign-in details</CardTitle>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-graphite">Email</dt>
              <dd>{user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-graphite">Member since</dt>
              <dd>{formatDate(user.createdAt)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-graphite">
            To change your email or close your account, write to <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
          </p>
        </Card>
        <Card>
          <CardTitle>Change password</CardTitle>
          <PasswordForm />
        </Card>
      </div>
    </>
  );
}
