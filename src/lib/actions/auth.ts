"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, generateResetToken, hashPassword, hashResetToken, RESET_MINUTES, verifyPassword } from "@/lib/auth";
import { clientIp, TOO_MANY_ATTEMPTS, withinLimit } from "@/lib/rate-limit";
import { sendMail, simpleEmail, siteUrl } from "@/lib/mail";
import { firstIssue, loginSchema, passwordSchema, registerSchema } from "@/lib/validation";
import { defaultPreferences } from "@/lib/defaults";

export interface FormState {
  error?: string;
  ok?: string;
}

function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "");
  return next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const ip = await clientIp();
  if (!(await withinLimit("login-ip", ip, 30, 600)) || !(await withinLimit("login-email", parsed.data.email, 10, 600))) {
    return { error: TOO_MANY_ATTEMPTS };
  }
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "That email and password don't match." };
  }
  await createSession(user);
  redirect(safeNext(formData.get("next")));
}

export async function register(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (!(await withinLimit("register-ip", await clientIp(), 10, 3600))) return { error: TOO_MANY_ATTEMPTS };
  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return { error: "An account with that email already exists. Sign in instead." };
  const { password, ...details } = parsed.data;
  const user = await db.user.create({
    data: {
      ...details,
      passwordHash: await hashPassword(password),
      profile: { create: {} },
      preferences: { create: defaultPreferences() },
    },
  });
  await createSession(user);
  redirect("/app/profile?welcome=1");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };
  if (!(await withinLimit("reset-ip", await clientIp(), 5, 3600)) || !(await withinLimit("reset-email", email, 3, 3600))) {
    return { error: TOO_MANY_ATTEMPTS };
  }
  const user = await db.user.findUnique({ where: { email } });
  // The same reply either way, so the form can't be used to find out who has an account.
  const ok = "If that address has an account, a reset link is on its way. It is valid for an hour.";
  if (!user) return { ok };
  const token = generateResetToken();
  await db.user.update({
    where: { id: user.id },
    data: { resetTokenHash: hashResetToken(token), resetTokenExpiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) },
  });
  const url = `${siteUrl()}/reset-password?uid=${user.id}&token=${token}`;
  const sent = await sendMail({
    to: user.email,
    subject: "Reset your Applya password",
    ...simpleEmail({
      title: "Reset your password",
      paragraphs: [`Hi ${user.firstName},`, "Use the button below to choose a new password. The link works for one hour.", "If you didn't ask for this, you can ignore this email."],
      button: { label: "Choose a new password", url },
    }),
  });
  if (!sent) console.log(`[auth] password reset link for ${user.email}: ${url}`);
  return { ok };
}

export async function resetPassword(_: FormState, formData: FormData): Promise<FormState> {
  const uid = String(formData.get("uid") ?? "");
  const token = String(formData.get("token") ?? "");
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return { error: firstIssue(password.error) };
  const user = await db.user.findUnique({ where: { id: uid } });
  if (!user || !user.resetTokenHash || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date() || user.resetTokenHash !== hashResetToken(token)) {
    return { error: "This link has expired. Ask for a new one." };
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password.data), resetTokenHash: null, resetTokenExpiresAt: null },
  });
  await createSession(user);
  redirect("/app");
}
