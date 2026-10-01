import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BRAND } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { PasswordForm } from "./password-form";
import { MailboxForm } from "./mailbox-form";

export const metadata: Metadata = { title: "Account" };

export default async function SettingsPage() {
  const user = await requireUser("/app/settings");
  const mailbox = await db.mailAccount.findUnique({ where: { userId: user.id } });
  return (
    <>
      <PageHeader eyebrow="Account" title="Account settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardTitle>Your mailbox</CardTitle>
          <MailboxForm
            connected={mailbox ? { fromEmail: mailbox.fromEmail, fromName: mailbox.fromName, host: mailbox.host, verifiedAt: formatDateTime(mailbox.verifiedAt), lastError: mailbox.lastError } : null}
            defaultEmail={user.email}
            defaultName={`${user.firstName} ${user.lastName}`}
          />
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
