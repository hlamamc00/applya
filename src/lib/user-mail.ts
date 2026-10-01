import "server-only";
import nodemailer from "nodemailer";
import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import type { MailAttachment } from "./mail";

// Sending from the person's own mailbox over SMTP. Gmail and Outlook both
// accept an app password; any other provider works with its SMTP details.

export const MAIL_PRESETS = {
  gmail: { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 587, help: "Turn on 2-step verification, then create an app password at myaccount.google.com/apppasswords and use it here." },
  outlook: { label: "Outlook / Hotmail / Microsoft 365", host: "smtp.office365.com", port: 587, help: "Create an app password under account.microsoft.com → Security → Advanced security options." },
  yahoo: { label: "Yahoo", host: "smtp.mail.yahoo.com", port: 465, help: "Create an app password under Account security." },
  icloud: { label: "iCloud", host: "smtp.mail.me.com", port: 587, help: "Create an app-specific password at appleid.apple.com." },
  other: { label: "Other (enter SMTP details)", host: "", port: 587, help: "Your provider's SMTP host, port and login." },
} as const;

export type MailPreset = keyof typeof MAIL_PRESETS;

export interface MailAccountInput {
  host: string;
  port: number;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
}

function transportFor(account: { host: string; port: number; username: string; passwordEnc: string }) {
  return nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.port === 465,
    auth: { user: account.username, pass: decrypt(account.passwordEnc) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
}

/** Saves the mailbox after checking the login works. Returns an error message, or null. */
export async function saveMailAccount(userId: string, input: MailAccountInput): Promise<string | null> {
  const passwordEnc = encrypt(input.password);
  const transport = transportFor({ host: input.host, port: input.port, username: input.username, passwordEnc });
  try {
    await transport.verify();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return /auth|535|534|credential|password/i.test(message) ? `The mailbox refused the login: ${message}` : `Couldn't reach ${input.host}:${input.port}: ${message}`;
  }
  await db.mailAccount.upsert({
    where: { userId },
    create: { userId, host: input.host, port: input.port, username: input.username, passwordEnc, fromName: input.fromName, fromEmail: input.fromEmail, verifiedAt: new Date() },
    update: { host: input.host, port: input.port, username: input.username, passwordEnc, fromName: input.fromName, fromEmail: input.fromEmail, verifiedAt: new Date(), lastError: null },
  });
  return null;
}

/** Sends from the user's mailbox. Returns the provider's message id. Throws with a readable message. */
export async function sendFromUser(userId: string, message: { to: string; subject: string; text: string; attachments?: MailAttachment[] }) {
  const account = await db.mailAccount.findUnique({ where: { userId } });
  if (!account) throw new Error("Connect your mailbox under Account first.");
  const from = account.fromName ? `${account.fromName} <${account.fromEmail}>` : account.fromEmail;
  try {
    const info = await transportFor(account).sendMail({ from, to: message.to, subject: message.subject, text: message.text, attachments: message.attachments });
    await db.mailAccount.update({ where: { userId }, data: { lastError: null } });
    return info.messageId as string;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await db.mailAccount.update({ where: { userId }, data: { lastError: detail } });
    throw new Error(`Your mailbox didn't accept the message: ${detail}`);
  }
}
