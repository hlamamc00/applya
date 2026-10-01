"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MAIL_PRESETS, saveMailAccount, sendFromUser, smtpHostFor, type MailPreset } from "@/lib/user-mail";
import { emailSchema } from "@/lib/validation";
import { int, str } from "@/lib/utils";
import type { FormState } from "./auth";

export async function connectMailbox(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/settings");
  const preset = str(formData.get("preset")) as MailPreset;
  const chosen = MAIL_PRESETS[preset] ?? MAIL_PRESETS.other;
  const fromEmail = emailSchema.safeParse(formData.get("fromEmail"));
  if (!fromEmail.success) return { error: "Enter the email address applications should come from." };
  const username = str(formData.get("username")) || fromEmail.data;
  const password = String(formData.get("password") ?? "");
  const host = preset === "other" ? str(formData.get("host")) : smtpHostFor(preset, fromEmail.data, chosen.host);
  const port = preset === "other" ? (int(formData.get("port")) ?? 587) : chosen.port;
  if (!host) return { error: "Enter the SMTP host." };
  if (!password) return { error: "Enter the app password for the mailbox." };
  const error = await saveMailAccount(user.id, { host, port, username, password, fromName: str(formData.get("fromName")) || `${user.firstName} ${user.lastName}`, fromEmail: fromEmail.data });
  if (error) return { error };
  revalidatePath("/app", "layout");
  return { ok: `Connected. Applications you approve can now be sent from ${fromEmail.data}.` };
}

export async function disconnectMailbox() {
  const user = await requireUser("/app/settings");
  await db.mailAccount.deleteMany({ where: { userId: user.id } });
  revalidatePath("/app", "layout");
}

export async function sendTestEmail(): Promise<FormState> {
  const user = await requireUser("/app/settings");
  try {
    await sendFromUser(user.id, { to: user.email, subject: "Applya test message", text: `Hi ${user.firstName},\n\nThis is a test from Applya. Applications you approve will be sent from this mailbox.\n` });
    return { ok: `Test sent to ${user.email}. Check your inbox (and the Sent folder of the connected mailbox).` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
