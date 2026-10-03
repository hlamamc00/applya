import "server-only";
import { db } from "./db";
import { cvFromProfile, parseCv } from "./cv";
import { renderCvPdf } from "./cv-pdf";
import { latestCv } from "./applications";
import { aiAvailable, generateJson } from "./llm";
import { sendFromUser } from "./user-mail";
import { isMailConfigured, onNetlify, sendMail, simpleEmail, siteUrl } from "./mail";
import type { MailAttachment } from "./mail";
import { fileSafeName } from "./utils";
import { decrypt } from "./crypto";
import { findAlternativeAdverts } from "./jobs/alternatives";
import type { ApplyPacket, FormField, PlannedValue } from "./apply-runner";

// Submitting an approved application: by email from the person's own
// mailbox, or by filling in the form on the employer's site through the
// apply-background function. Everything the browser needs comes from
// buildPacket(); planValues() decides what goes in each field; recordResult()
// keeps what happened.

/** The address the advert says to apply to, if any. */
export function applyEmailFor(job: { applyEmail: string | null; description: string }, application: { applyEmail: string | null }) {
  return application.applyEmail ?? job.applyEmail ?? /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(job.description)?.[0]?.toLowerCase() ?? null;
}

/** Whether the employer's site can be applied to in the browser (any web page can be tried). */
export function canApplyOnSite(job: { url: string; applyKind: string | null }) {
  return /^https?:/.test(job.url) && job.applyKind !== "EMAIL";
}

async function approvedCv(app: { id: string; approvedCvId: string | null }) {
  const version = app.approvedCvId ? await db.cvVersion.findUnique({ where: { id: app.approvedCvId } }) : await latestCv(app.id);
  if (!version) throw new Error("No approved CV version");
  return version;
}

// --- Email -----------------------------------------------------------------

/** Sends the approved CV and message from the person's mailbox and marks the application submitted. */
export async function submitByEmail(applicationId: string, to: string, subject?: string) {
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId }, include: { job: true, user: true } });
  const version = await approvedCv(app);
  const pdf = await renderCvPdf(parseCv(version.content));
  const attempt = await db.applicationAttempt.create({ data: { applicationId, kind: "EMAIL", status: "RUNNING" } });
  try {
    const messageId = await sendFromUser(app.userId, {
      to,
      subject: subject || `Application: ${app.job.title} – ${app.user.firstName} ${app.user.lastName}`,
      text: app.coverMessage,
      attachments: [cvAttachment(app.user, pdf)],
    });
    const copied = await emailApplicant(app.userId, {
      subject: `Copy of your application: ${app.job.title} – ${app.job.company}`,
      title: `Sent to ${to}`,
      paragraphs: [`Your application for ${app.job.title} at ${app.job.company} was sent to ${to} from your mailbox. The message and the CV that went with it are below and attached.`, "—", app.coverMessage],
      buttonUrl: `${siteUrl()}/app/applications/${app.id}`,
      attachments: [cvAttachment(app.user, pdf)],
    });
    await db.$transaction([
      db.applicationAttempt.update({ where: { id: attempt.id }, data: { status: "SUBMITTED", detail: `Sent to ${to}`, finishedAt: new Date() } }),
      db.application.update({
        where: { id: applicationId },
        data: { status: "SUBMITTED", submittedAt: new Date(), submittedVia: "EMAIL", applyEmail: to, sentTo: to, sentMessageId: messageId, events: { create: { kind: "SUBMITTED", detail: `Sent by email to ${to} from your mailbox (CV version "${version.label}")` } } },
      }),
    ]);
    return { ok: true as const, message: `Sent to ${to}.${copied ? " A copy is on its way to your inbox." : " A copy is in your mailbox's Sent folder."}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await db.$transaction([
      db.applicationAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", detail, finishedAt: new Date() } }),
      db.application.update({ where: { id: applicationId }, data: { status: "NEEDS_YOU", events: { create: { kind: "FAILED", detail: `Email not sent: ${detail}` } } } }),
    ]);
    return { ok: false as const, message: detail };
  }
}

// --- Copies to the applicant ----------------------------------------------------

/**
 * Emails the applicant their own copy (or a notice) from Applya's own address
 * (SMTP_* / MAIL_FROM). Their connected mailbox is only ever used to write to
 * employers. Never throws.
 */
async function emailApplicant(userId: string, mail: { subject: string; title: string; paragraphs: string[]; buttonUrl?: string; attachments?: MailAttachment[] }) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return false;
  const text = `${mail.paragraphs.join("\n\n")}${mail.buttonUrl ? `\n\n${mail.buttonUrl}` : ""}`;
  try {
    if (!isMailConfigured()) {
      console.warn("[apply] SMTP_* not set, so no copy was emailed to the applicant");
      return false;
    }
    const { html } = simpleEmail({ title: mail.title, paragraphs: mail.paragraphs, button: mail.buttonUrl ? { label: "Open in Applya", url: mail.buttonUrl } : undefined });
    return await sendMail({ to: user.email, subject: mail.subject, html, text, attachments: mail.attachments });
  } catch (error) {
    console.warn(`[apply] couldn't email the applicant a copy: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function cvAttachment(user: { firstName: string; lastName: string }, pdf: Uint8Array): MailAttachment {
  return { filename: `${fileSafeName(user.firstName, user.lastName)}_CV.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" };
}

// --- Site forms --------------------------------------------------------------

/** Starts the browser on Netlify (or runs it here in development) for one attempt. */
export async function startSiteApply(applicationId: string, mode: "LIVE" | "PREVIEW") {
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId }, include: { job: true } });
  await approvedCv(app);
  const running = await db.applicationAttempt.findFirst({ where: { applicationId, kind: "FORM", status: { in: ["QUEUED", "RUNNING"] }, startedAt: { gt: new Date(Date.now() - 20 * 60_000) } } });
  if (running) return { ok: false as const, message: "A browser is already working on this application; the result appears here when it's done." };
  const attempt = await db.applicationAttempt.create({ data: { applicationId, kind: "FORM", mode, status: "QUEUED" } });
  if (mode === "LIVE") {
    await db.application.update({ where: { id: applicationId }, data: { status: "SUBMITTING", events: { create: { kind: "SUBMITTING", detail: `Applying on ${new URL(app.job.applyUrl || app.job.url).host} in the background` } } } });
  } else {
    await db.application.update({ where: { id: applicationId }, data: { events: { create: { kind: "PREVIEW", detail: "Filling in the employer's form without submitting, to show what would be sent" } } } });
  }
  const secret = process.env.CRON_SECRET;
  if (onNetlify() && secret) {
    const internal = process.env.SITE_NAME ? `https://${process.env.SITE_NAME}.netlify.app` : siteUrl();
    const res = await fetch(`${internal}/.netlify/functions/apply-background`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ applicationId, attemptId: attempt.id }) });
    if (res.status !== 202 && !res.ok) {
      await recordResult(attempt.id, { status: "FAILED", detail: `The browser function couldn't be started (${res.status}).`, log: [], finalUrl: "" });
      return { ok: false as const, message: `The browser couldn't be started (${res.status}).` };
    }
    return { ok: true as const, attemptId: attempt.id, message: mode === "LIVE" ? "Applying now. The browser is filling in the form; the result appears here when it's done." : "Filling in the form in the background; the preview appears here when it's ready." };
  }
  // Development: run in this process with a local Chromium.
  const { runLocally } = await import("./apply-local");
  void runLocally(applicationId, attempt.id).catch((error) => console.error("[apply] local run failed", error));
  return { ok: true as const, attemptId: attempt.id, message: "Running in a local browser; the result appears here when it's done." };
}

/** Everything the browser needs for one attempt. */
export async function buildPacket(applicationId: string, attemptId: string): Promise<ApplyPacket> {
  const [app, attempt] = await Promise.all([
    db.application.findUniqueOrThrow({ where: { id: applicationId }, include: { job: true, user: { include: { profile: true } } } }),
    db.applicationAttempt.findUniqueOrThrow({ where: { id: attemptId } }),
  ]);
  const version = await approvedCv(app);
  const cv = parseCv(version.content);
  const profile = app.user.profile ?? (await db.profile.create({ data: { userId: app.userId } }));
  const base = cvFromProfile(app.user, profile);
  const pdf = await renderCvPdf(cv);
  const link = (re: RegExp) => base.links.find((l) => re.test(l.url))?.url ?? "";
  const salary = profile.salaryMin && profile.salaryMax ? `£${profile.salaryMin.toLocaleString()} – £${profile.salaryMax.toLocaleString()}` : profile.salaryMin ? `£${profile.salaryMin.toLocaleString()}` : profile.salaryNote;
  await db.applicationAttempt.update({ where: { id: attemptId }, data: { status: "RUNNING" } });
  // The same vacancy on the employer's or agency's own site, where no
  // job-board account is needed: the browser tries those routes first.
  const alternatives = await findAlternativeAdverts(app.job).catch(() => [] as string[]);
  const portals = await db.portalAccount.findMany({ where: { userId: app.userId } });
  const logins = portals.flatMap((p) => {
    try {
      return [{ host: p.host, username: p.username, password: decrypt(p.passwordEnc) }];
    } catch {
      return [];
    }
  });
  return {
    applicationId,
    attemptId,
    dryRun: attempt.mode === "PREVIEW",
    logins,
    job: { url: app.job.url, applyUrl: app.job.applyUrl, title: app.job.title, company: app.job.company, alternatives },
    applicant: {
      firstName: app.user.firstName,
      lastName: app.user.lastName,
      email: base.email,
      phone: base.phone,
      location: base.location,
      linkedin: link(/linkedin/i),
      website: link(/^(?!.*linkedin)/i),
      summary: cv.summary,
      coverMessage: app.coverMessage,
      facts: { availability: profile.availability, noticePeriod: profile.noticePeriod, rightToWork: profile.rightToWork, salary, visaExpiresAt: profile.visaExpiresAt?.toISOString().slice(0, 10) ?? "" },
      cvFileName: `${fileSafeName(app.user.firstName, app.user.lastName)}_CV.pdf`,
      cvPdfBase64: Buffer.from(pdf).toString("base64"),
    },
  };
}

/** What goes in each field: rules for the common ones, the AI for the rest. */
export async function planValues(packet: ApplyPacket, fields: FormField[], pageText: string): Promise<PlannedValue[]> {
  const a = packet.applicant;
  const fullName = `${a.firstName} ${a.lastName}`.trim();
  const byRule = new Map<number, PlannedValue>();
  const yes = (f: FormField, want: RegExp) => f.options.find((o) => want.test(o.label) || want.test(o.value));
  for (const f of fields) {
    const l = `${f.label} ${f.placeholder} ${f.name}`.toLowerCase();
    const set = (action: PlannedValue["action"], value?: string | string[]) => byRule.set(f.id, { id: f.id, action, value });
    if (f.type === "file") {
      if (/cover|letter/.test(l) && !/cv|resume|résumé/.test(l)) set("skip");
      else set("file");
      continue;
    }
    if (f.type === "password") continue;
    if (f.options.length && (f.type === "radio" || f.type === "checkbox")) {
      if (/right to work|eligible to work|legally (entitled|authori[sz]ed)|work authori[sz]ation|permission to work/.test(l)) {
        const o = yes(f, /^yes/i);
        if (o) set("check", o.label);
      } else if (/sponsor|visa/.test(l) && /require|need/.test(l)) {
        const o = yes(f, /^no/i);
        if (o) set("check", o.label);
      } else if (/privacy|consent|agree|terms|gdpr|data protection|acknowledge/.test(l) && (f.required || f.options.length === 1)) {
        set("check", f.options[0].label);
      } else if (/marketing|newsletter|updates|job alert/.test(l)) {
        set("skip");
      }
      continue;
    }
    if (f.tag === "select" && f.options.length) {
      if (/country/.test(l)) set("select", yes(f, /united kingdom|^uk$|great britain/i)?.label ?? "United Kingdom");
      else if (/how did you hear|source|where did you/.test(l)) set("select", yes(f, /job board|other|online|website/i)?.label ?? f.options[0].label);
      else if (/notice/.test(l) && a.facts.noticePeriod) set("select", a.facts.noticePeriod);
      continue;
    }
    if (/first ?name|given name|forename/.test(l)) set("type", a.firstName);
    else if (/last ?name|surname|family name/.test(l)) set("type", a.lastName);
    else if (/full name|^name$|your name|\bname\b/.test(l) && !/company|employer|user ?name|file/.test(l)) set("type", fullName);
    else if (/e-?mail/.test(l) || f.type === "email") set("type", a.email);
    else if (/phone|mobile|tel/.test(l) || f.type === "tel") set("type", a.phone);
    else if (/linkedin/.test(l)) set("type", a.linkedin);
    else if (/website|portfolio|github|url/.test(l) && !/linkedin/.test(l)) set("type", a.website);
    else if (/city|location|town|where (are you|do you) (based|live)/.test(l)) set("type", a.location.split(",")[0].trim());
    else if (/country/.test(l)) set("type", "United Kingdom");
    else if (/post ?code|zip/.test(l)) set("skip");
    else if (/cover letter|covering letter|message|why (do you want|are you interested)|motivation|supporting statement|additional information|anything else/.test(l) && f.tag === "textarea") set("type", a.coverMessage);
    else if (/salary|remuneration|pay expectation/.test(l)) set("type", a.facts.salary || "Flexible, in line with the advertised range");
    else if (/notice/.test(l)) set("type", a.facts.noticePeriod || "None");
    else if (/start date|available|availability|when can you start/.test(l)) set("type", a.facts.availability || "Immediately");
    else if (/right to work|visa|sponsor|work authori/.test(l)) set("type", a.facts.rightToWork || "Yes");
    else if (/how did you hear|source/.test(l)) set("type", "Job board");
    else if (/current (job )?title|job title|current role/.test(l)) set("type", "");
    else if (/current (company|employer)/.test(l)) set("type", "");
  }
  // The AI covers the questions the rules didn't, with the rules' answers as given.
  const open = fields.filter((f) => !byRule.has(f.id) && f.type !== "password" && f.type !== "file");
  if (open.length && aiAvailable()) {
    try {
      const { data } = await generateJson<{ values: { id: number; action: string; value?: string | string[] }[] }>({
        system: [
          "You fill in a job application form for a candidate, honestly, from the facts given. Never invent qualifications, employers or dates. Answer yes/no questions from the facts; for right to work in the UK the candidate answers yes and does not need sponsorship. For questions about the candidate's motivation or fit, write 2–4 sentences in British English from the summary and cover message. Choose options by their exact label. Skip optional marketing or demographic questions (action 'skip'); for required equal-opportunities questions choose 'Prefer not to say' if offered. If a question needs something the facts don't cover (a reference, an ID or NI number, a specific date, a previous address, a qualification not listed), answer with action 'skip' so the candidate can be asked; never guess.",
          'Reply with a JSON object only: {"values":[{"id":number,"action":"type"|"select"|"check"|"skip","value":string|string[]}]}. type = free text; select = one option label; check = one or more option labels. Include every field id given.',
        ].join(" "),
        user: JSON.stringify({
          job: packet.job,
          candidate: { name: fullName, email: a.email, phone: a.phone, location: a.location, linkedin: a.linkedin, summary: a.summary, coverMessage: a.coverMessage, facts: a.facts },
          fields: open.map((f) => ({ id: f.id, label: f.label, placeholder: f.placeholder, type: f.type, required: f.required, options: f.options.map((o) => o.label).slice(0, 40), context: f.context.slice(0, 200) })),
          pageText: pageText.slice(0, 1500),
        }),
        maxTokens: 3000,
        budgetMs: 15_000,
      });
      for (const v of data.values ?? []) {
        if (!open.some((f) => f.id === v.id)) continue;
        const action = (["type", "select", "check", "skip"] as const).includes(v.action as never) ? (v.action as PlannedValue["action"]) : "skip";
        byRule.set(v.id, { id: v.id, action, value: v.value });
      }
    } catch (error) {
      console.warn("[apply] AI planning failed; leaving open questions blank", error);
    }
  }
  return fields.map((f) => byRule.get(f.id) ?? { id: f.id, action: "skip" });
}

/** Keeps the browser's report and moves the application on. */
export async function recordResult(attemptId: string, result: { status: string; detail: string; finalUrl?: string; log?: string[]; screenshotBase64?: string }) {
  const attempt = await db.applicationAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { application: { include: { job: true, user: true } } } });
  const status = ["SUBMITTED", "PREVIEWED", "NEEDS_YOU", "FAILED"].includes(result.status) ? result.status : "FAILED";
  const screenshot = result.screenshotBase64 ? Buffer.from(result.screenshotBase64.slice(0, 2_000_000), "base64") : undefined;
  await db.applicationAttempt.update({
    where: { id: attemptId },
    data: { status, detail: result.detail.slice(0, 1000), finalUrl: result.finalUrl?.slice(0, 1000) ?? null, log: (result.log ?? []).slice(-60), screenshot, finishedAt: new Date() },
  });
  const app = attempt.application;
  for (const line of result.log ?? []) {
    const m = /^(Signed in to|Signing in to) (\S+?)( didn't work)?$/.exec(line);
    if (!m) continue;
    await db.portalAccount.updateMany({ where: { userId: app.userId, host: m[2] }, data: { lastUsedAt: new Date(), lastResult: m[3] ? "Sign-in failed last time" : "Signed in" } });
  }
  if (attempt.mode === "PREVIEW") {
    await db.application.update({ where: { id: app.id }, data: { events: { create: { kind: "PREVIEW", detail: status === "PREVIEWED" ? "Form preview ready" : `Preview: ${result.detail}` } } } });
    return;
  }
  const link = `${siteUrl()}/app/applications/${app.id}`;
  if (status === "SUBMITTED") {
    await db.application.update({
      where: { id: app.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), submittedVia: "FORM", events: { create: { kind: "SUBMITTED", detail: `Applied on ${new URL(result.finalUrl || app.job.url).host}: ${result.detail}` } } },
    });
    // The applicant's copy: what was said, the CV that went in and the final screen.
    const version = await approvedCv(app).catch(() => null);
    const pdf = version ? await renderCvPdf(parseCv(version.content)) : null;
    const attachments: MailAttachment[] = [];
    if (pdf) attachments.push(cvAttachment(app.user, pdf));
    if (screenshot) attachments.push({ filename: "submitted-form.jpg", content: screenshot, contentType: "image/jpeg" });
    await emailApplicant(app.userId, {
      subject: `Copy of your application: ${app.job.title} – ${app.job.company}`,
      title: `Applied on ${new URL(result.finalUrl || app.job.url).host}`,
      paragraphs: [`Your application for ${app.job.title} at ${app.job.company} was submitted on the employer's site. ${result.detail}`, "The cover message used, the CV attached and a screenshot of the final screen are included.", "—", app.coverMessage, "—", `What the browser did:\n${(result.log ?? []).slice(-25).join("\n")}`],
      buttonUrl: link,
      attachments,
    });
  } else {
    await db.application.update({
      where: { id: app.id },
      data: { status: "NEEDS_YOU", events: { create: { kind: "NEEDS_YOU", detail: result.detail } } },
    });
    if (status === "NEEDS_YOU") {
      await emailApplicant(app.userId, {
        subject: `${/additional information/i.test(result.detail) ? "Additional information required" : "Needs you"}: ${app.job.title} – ${app.job.company}`,
        title: "The application couldn't be finished without you",
        paragraphs: [result.detail, result.finalUrl ? `Where it stopped: ${result.finalUrl}` : "", "Open the application in Applya to see the screenshot, add what's missing to your profile and try again, or finish it on the site yourself."].filter(Boolean),
        buttonUrl: link,
        attachments: screenshot ? [{ filename: "form.jpg", content: screenshot, contentType: "image/jpeg" }] : undefined,
      });
    }
  }
}
