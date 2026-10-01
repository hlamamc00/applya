import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { BRAND } from "./types";

// Transactional email goes out over SMTP so any provider works (Resend's SMTP
// relay, Brevo, Postmark, a Gmail app password). With no SMTP_* variables set
// nothing is sent and the app carries on: an email failure never breaks a
// request, so sendMail logs and returns false instead of throwing.

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

let transport: Transporter | null | undefined;

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  if (!isMailConfigured()) {
    transport = null;
    return transport;
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS!.trim() },
  });
  return transport;
}

export function mailFrom() {
  const explicit = process.env.MAIL_FROM?.trim();
  if (explicit) return explicit.includes("<") ? explicit : `${BRAND.name} <${explicit}>`;
  const user = process.env.SMTP_USER?.trim() ?? "";
  return user.includes("@") ? `${BRAND.name} <${user}>` : `${BRAND.name} <no-reply@${BRAND.domain}>`;
}

export function siteUrl() {
  return (process.env.SITE_URL ?? process.env.URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Sends one email. Resolves true when accepted by the SMTP server, false otherwise (never throws). */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const t = getTransport();
  if (!t) {
    console.warn(`[mail] SMTP not configured, skipped "${message.subject}" to ${message.to}`);
    return false;
  }
  try {
    const info = await t.sendMail({ from: mailFrom(), ...message });
    console.log(`[mail] sent "${message.subject}" to ${message.to} (${info.messageId})`);
    return true;
  } catch (error) {
    console.error(`[mail] failed to send "${message.subject}" to ${message.to}`, error);
    return false;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A short branded email around a few paragraphs and one button. */
export function simpleEmail(opts: { title: string; paragraphs: string[]; button?: { label: string; url: string } }) {
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p)}</p>`).join("");
  const button = opts.button
    ? `<p style="margin:22px 0"><a href="${opts.button.url}" style="background:#0e1a3a;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(opts.button.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;color:#0e1a3a"><div style="max-width:560px;margin:0 auto;padding:32px 20px"><p style="font-size:22px;font-weight:700;letter-spacing:-0.5px;margin:0 0 24px">applya<span style="color:#0fa968">.</span></p><h1 style="font-family:Georgia,serif;font-size:26px;margin:0 0 18px">${escapeHtml(opts.title)}</h1>${body}${button}<p style="color:#60737b;font-size:12px;margin-top:30px">${escapeHtml(BRAND.name)} is operated by ${escapeHtml(BRAND.operator)} · ${escapeHtml(BRAND.supportEmail)}</p></div></body></html>`;
  const text = [opts.title, "", ...opts.paragraphs, opts.button ? `\n${opts.button.label}: ${opts.button.url}` : ""].join("\n");
  return { html, text };
}
