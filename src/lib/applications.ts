import "server-only";
import { db } from "./db";
import { cvFromProfile, parseCv, type CvDocument } from "./cv";
import { tailor } from "./tailor";

// Creating and moving applications. Every change writes an ApplicationEvent
// so the page shows what happened and when.

/** Builds a draft for a job: a tailored CV version and a cover message. */
export async function prepareDraft(userId: string, jobId: string, options: { autoApprove?: boolean } = {}) {
  const [user, job] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } }),
    db.job.findUniqueOrThrow({ where: { id: jobId } }),
  ]);
  const profile = user.profile ?? (await db.profile.create({ data: { userId } }));
  const base = cvFromProfile(user, profile);
  const result = await tailor(
    {
      cv: base,
      job: { title: job.title, company: job.company, location: job.location, description: job.description },
      facts: { availability: profile.availability, noticePeriod: profile.noticePeriod, rightToWork: profile.rightToWork, salaryNote: profile.salaryNote },
    },
    { allowAi: profile.aiTailoring },
  );

  const canAutoApprove = Boolean(options.autoApprove);
  const application = await db.application.create({
    data: {
      userId,
      jobId,
      status: canAutoApprove ? "APPROVED" : "IN_REVIEW",
      coverMessage: result.coverMessage,
      approvedAt: canAutoApprove ? new Date() : null,
      events: {
        create: [
          { kind: "CREATED", detail: `Draft prepared (${result.method === "AI" ? "AI tailoring" : "keyword tailoring"})` },
          ...(canAutoApprove ? [{ kind: "APPROVED", detail: "Approved automatically (your preference)" }] : []),
        ],
      },
    },
  });
  const version = await db.cvVersion.create({
    data: { userId, applicationId: application.id, label: `Tailored for ${job.company}`, content: result.cv as object, method: result.method },
  });
  if (canAutoApprove) await db.application.update({ where: { id: application.id }, data: { approvedCvId: version.id } });
  await db.match.upsert({
    where: { userId_jobId: { userId, jobId } },
    create: { userId, jobId, score: 0, reasons: ["Drafted by hand"], status: "DRAFTED" },
    update: { status: "DRAFTED" },
  });
  return application;
}

/** Saves an edited CV as a new version; approval no longer applies to it. */
export async function saveCvVersion(applicationId: string, userId: string, content: CvDocument, label: string) {
  const version = await db.cvVersion.create({ data: { userId, applicationId, label, content: parseCv(content) as object, method: "MANUAL" } });
  const app = await db.application.findUniqueOrThrow({ where: { id: applicationId } });
  if (app.status === "APPROVED") {
    await db.application.update({
      where: { id: applicationId },
      data: { status: "IN_REVIEW", approvedCvId: null, approvedAt: null, events: { create: { kind: "EDITED", detail: "CV edited after approval; needs a new approval" } } },
    });
  } else {
    await db.application.update({ where: { id: applicationId }, data: { events: { create: { kind: "EDITED", detail: "CV edited" } } } });
  }
  return version;
}

/** The newest CV version on an application. */
export async function latestCv(applicationId: string) {
  return db.cvVersion.findFirst({ where: { applicationId }, orderBy: { createdAt: "desc" } });
}
