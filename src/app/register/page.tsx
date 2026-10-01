import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create an account" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/app");
  return (
    <AuthShell title="Create your account" intro="Your profile, CVs and applications stay private to you.">
      <RegisterForm />
    </AuthShell>
  );
}
