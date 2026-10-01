import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { BRAND } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Account" };

export default async function SettingsPage() {
  const user = await requireUser("/app/settings");
  return (
    <>
      <PageHeader eyebrow="Account" title="Account settings" />
      <div className="grid gap-6 lg:grid-cols-2">
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
