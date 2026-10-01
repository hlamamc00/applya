import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ uid?: string; token?: string }> }) {
  const { uid = "", token = "" } = await searchParams;
  return (
    <AuthShell title="Choose a new password">
      <ResetForm uid={uid} token={token} />
    </AuthShell>
  );
}
