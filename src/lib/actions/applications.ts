"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseCv, rightToWorkStatement } from "@/lib/cv";
import { latestCv, prepareDraft, saveCvVersion } from "@/lib/applications";
import { startScan } from "@/lib/jobs/scan";
import { isApplicationStatus } from "@/lib/types";
import { str } from "@/lib/utils";
import { emailSchema } from "@/lib/validation";
import { applyEmailFor, asAnswers, canApplyOnSite, startSiteApply, submitByEmail } from "@/lib/apply";
import type { FormState } from "./auth";

async function ownedApplication(id: string, userId: string) {
  const app = await db.application.findFirst({ where: { id, userId } });
  if (!app) throw new Error("Application not found");
  return app;
}

/** "Prepare a draft" from a match. */
export async function draftForJob(formData: FormData) {
  const user = await requireUser("/app/jobs");
  const jobId = str(formData.get("jobId"));
  const existing = await db.application.findUnique({ where: { userId_jobId: { userId: user.id, jobId } } });
  if (existing) redirect(`/app/applications/${existing.id}`);
  const app = await prepareDraft(user.id, jobId);
  revalidatePath("/app", "layout");
  redirect(`/app/applications/${app.id}`);
}

export async function setMatchStatus(formData: FormData) {
  const user = await requireUser("/app/jobs");
  const jobId = str(formData.get("jobId"));
  const status = str(formData.get("status"));
  if (!["NEW", "SHORTLISTED", "DISMISSED"].includes(status)) return;
  await db.match.updateMany({ where: { userId: user.id, jobId }, data: { status } });
  revalidatePath("/app/jobs");
}

export async function scanNow(): Promise<FormState> {
  const user = await requireUser("/app/jobs");
  const result = await startScan("MANUAL", { onlyUserId: user.id });
  revalidatePath("/app", "layout");
  return result.started ? { ok: result.message } : { error: result.message };
}

export async function saveMessage(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/applications");
  const app = await ownedApplication(str(formData.get("id")), user.id);
  const coverMessage = String(formData.get("coverMessage") ?? "").trim().slice(0, 6000);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 4000);
  const changedMessage = coverMessage !== app.coverMessage;
  await db.application.update({
    where: { id: app.id },
    data: {
      coverMessage,
      notes,
      // An approved message that changes needs approving again, like the CV.
      ...(changedMessage && app.status === "APPROVED" ? { status: "IN_REVIEW", approvedAt: null, approvedCvId: null } : {}),
      ...(changedMessage ? { events: { create: { kind: "EDITED", detail: app.status === "APPROVED" ? "Message edited after approval; needs a new approval" : "Message edited" } } } : {}),
    },
  });
  revalidatePath(`/app/applications/${app.id}`);
  return { ok: "Saved." };
}

export async function saveCv(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/applications");
  const app = await ownedApplication(str(formData.get("id")), user.id);
  let content: unknown;
  try {
    content = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { error: "The CV couldn't be read. Reload and try again." };
  }
  const cv = parseCv(content);
  if (!cv.name.trim()) return { error: "The CV needs a name." };
  await saveCvVersion(app.id, user.id, cv, "Edited by you");
  revalidatePath(`/app/applications/${app.id}`);
  return { ok: "CV saved as a new version." };
}

export async function retailor(formData: FormData) {
  const user = await requireUser("/app/applications");
  const app = await ownedApplication(str(formData.get("id")), user.id);
  const [job, profile] = await Promise.all([db.job.findUniqueOrThrow({ where: { id: app.jobId } }), db.profile.findUniqueOrThrow({ where: { userId: user.id } })]);
  const { tailor } = await import("@/lib/tailor");
  const { cvFromProfile } = await import("@/lib/cv");
  const result = await tailor(
    {
      cv: cvFromProfile(user, profile),
      job: { title: job.title, company: job.company, location: job.location, description: job.description },
      facts: { availability: profile.availability, noticePeriod: profile.noticePeriod, rightToWork: rightToWorkStatement(profile.rightToWork), salaryNote: profile.salaryNote },
    },
    { allowAi: profile.aiTailoring },
  );
  await db.cvVersion.create({ data: { userId: user.id, applicationId: app.id, label: `Re-tailored for ${job.company}`, content: result.cv as object, method: result.method } });
  await db.application.update({
    where: { id: app.id },
    data: {
      coverMessage: result.coverMessage,
      status: app.status === "APPROVED" ? "IN_REVIEW" : app.status,
      approvedAt: app.status === "APPROVED" ? null : app.approvedAt,
      approvedCvId: app.status === "APPROVED" ? null : app.approvedCvId,
      events: { create: { kind: "TAILORED", detail: `Re-tailored from your current profile (${result.method === "AI" ? "AI" : "keyword"} tailoring)` } },
    },
  });
  revalidatePath(`/app/applications/${app.id}`);
}

export async function approve(formData: FormData) {
  const user = await requireUser("/app/applications");
  const app = await ownedApplication(str(formData.get("id")), user.id);
  const version = await latestCv(app.id);
  if (!version) throw new Error("No CV version to approve");
  // The approval names the version that was on screen, so a save that raced
  // the approval can't be approved unseen.
  const seen = str(formData.get("cvVersionId"));
  if (seen && seen !== version.id) {
    revalidatePath(`/app/applications/${app.id}`);
    redirect(`/app/applications/${app.id}?stale=1`);
  }
  await db.application.update({
    where: { id: app.id },
    data: { status: "APPROVED", approvedCvId: version.id, approvedAt: new Date(), events: { create: { kind: "APPROVED", detail: `Approved CV version "${version.label}"` } } },
  });
  // "Approve & send" / "Approve & apply": the submission follows at once.
  const then = str(formData.get("then"));
  if (then === "email") {
    const job = await db.job.findUniqueOrThrow({ where: { id: app.jobId } });
    const to = emailSchema.safeParse(formData.get("to") || applyEmailFor(job, app));
    if (to.success) await submitByEmail(app.id, to.data);
  } else if (then === "site") {
    await startSiteApply(app.id, "LIVE");
  }
  revalidatePath("/app", "layout");
}

/** "Apply on their site now" for an approved application. */
export async function applyOnSite(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/applications");
  const app = await ownedApplication(str(formData.get("id")), user.id);
  if (!["APPROVED", "NEEDS_YOU"].includes(app.status)) return { error: "Approve the application first." };
  const job = await db.job.findUniqueOrThrow({ where: { id: app.jobId } });
  if (!canApplyOnSite(job)) return { error: "This advert asks for applications by email, not on a site." };
  const result = await startSiteApply(app.id, str(formData.get("mode")) === "PREVIEW" ? "PREVIEW" : "LIVE");
  revalidatePath(`/app/applications/${app.id}`);
  return result.ok ? { ok: result.message } : { error: result.message };
}

const transition = z.object({ id: z.string(), status: z.string(), via: z.string().optional() });

export async function setStatus(formData: FormData) {
  const user = await requireUser("/app/applications");
  const parsed = transition.parse({ id: formData.get("id"), status: formData.get("status"), via: formData.get("via") ?? undefined });
  const app = await ownedApplication(parsed.id, user.id);
  if (!isApplicationStatus(parsed.status)) return;
  const status = parsed.status;
  if (status === "SUBMITTED" && !["APPROVED", "SUBMITTED", "NEEDS_YOU", "SUBMITTING"].includes(app.status)) throw new Error("Approve the application before marking it submitted");
  const detail: Record<string, string> = {
    SUBMITTED: `Marked as submitted${parsed.via ? ` (${parsed.via.toLowerCase()})` : ""}`,
    WITHDRAWN: "Withdrawn",
    REJECTED: "Marked as rejected",
    INTERVIEW: "Interview arranged",
    OFFER: "Offer received",
    IN_REVIEW: "Approval removed; back in review",
    NEEDS_YOU: "Needs you",
    SUBMITTING: "Applying",
    DRAFT: "Back to draft",
    APPROVED: "Approved",
  };
  await db.application.update({
    where: { id: app.id },
    data: {
      status,
      ...(status === "SUBMITTED" ? { submittedAt: app.submittedAt ?? new Date(), submittedVia: parsed.via ?? "LINK" } : {}),
      ...(status === "IN_REVIEW" ? { approvedAt: null, approvedCvId: null } : {}),
      events: { create: { kind: status, detail: detail[status] ?? status } },
    },
  });
  revalidatePath("/app", "layout");
}

export async function deleteApplication(formData: FormData) {
  const user = await requireUser("/app/applications");
  const app = await ownedApplication(str(formData.get("id")), user.id);
  await db.application.delete({ where: { id: app.id } });
  await db.match.updateMany({ where: { userId: user.id, jobId: app.jobId, status: "DRAFTED" }, data: { status: "NEW" } });
  revalidatePath("/app", "layout");
  redirect("/app/applications");
}

/** Sends the approved CV and message from the user's own mailbox and marks the application submitted. */
export async function sendByEmail(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/applications");
  const app = await ownedApplication(str(formData.get("id")), user.id);
  if (!["APPROVED", "NEEDS_YOU"].includes(app.status)) return { error: "Approve the application first; only the approved version is sent." };
  const to = emailSchema.safeParse(formData.get("to"));
  if (!to.success) return { error: "Enter the employer's email address." };
  const subject = str(formData.get("subject")).slice(0, 200);
  if (!subject) return { error: "Give the email a subject." };
  const result = await submitByEmail(app.id, to.data, subject);
  revalidatePath("/app", "layout");
  return result.ok ? { ok: result.message } : { error: result.message };
}

/**
 * Answers to the questions a form asked that the profile couldn't cover.
 * They are kept on the application (and, if asked, on the profile for future
 * forms), then the browser goes back and carries on.
 */
export async function answerQuestions(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/applications");
  const app = await db.application.findFirst({ where: { id: str(formData.get("id")), userId: user.id }, include: { job: true, user: { include: { profile: true } } } });
  if (!app) return { error: "Application not found." };
  const given: { question: string; answer: string }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("q:")) continue;
    const question = key.slice(2).trim();
    const answer = formData.getAll(key).map((v) => String(v).trim()).filter(Boolean).join("; ");
    if (question && answer) given.push({ question, answer });
  }
  if (given.length === 0) return { error: "Answer at least one question." };
  const merge = (old: unknown) => [...asAnswers(old).filter((x) => !given.some((g) => g.question === x.question)), ...given];
  await db.application.update({ where: { id: app.id }, data: { answers: merge(app.answers) } });
  if (formData.get("remember") === "on" && app.user.profile) {
    await db.profile.update({ where: { id: app.user.profile.id }, data: { answers: merge(app.user.profile.answers) } });
  }
  const then = str(formData.get("then"));
  if (then === "apply" || then === "preview") {
    if (!canApplyOnSite(app.job)) return { error: "This advert asks for applications by email, not on a site." };
    const result = await startSiteApply(app.id, then === "preview" ? "PREVIEW" : "LIVE");
    revalidatePath(`/app/applications/${app.id}`);
    return result.ok ? { ok: `Saved ${given.length} answer${given.length === 1 ? "" : "s"}. ${result.message}` } : { error: result.message };
  }
  revalidatePath(`/app/applications/${app.id}`);
  return { ok: `Saved ${given.length} answer${given.length === 1 ? "" : "s"}.` };
}
