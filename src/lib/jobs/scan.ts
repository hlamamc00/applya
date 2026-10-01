import "server-only";
import { db } from "@/lib/db";
import type { SourceKind } from "@/lib/types";
import { connectors, sourceReady, type FoundJob, type SourceConfig } from "./sources";
import { DRAFT_THRESHOLD, scoreJob, type MatchPreferences } from "./matching";
import { prepareDraft } from "@/lib/applications";
import { sendMail, simpleEmail, siteUrl } from "@/lib/mail";

// One scan: read every enabled source, store the adverts, score them for every
// user with daily scanning on, and prepare drafts for the strong matches.

export interface ScanSummary {
  runId: string;
  jobsFound: number;
  jobsNew: number;
  matchesNew: number;
  draftsNew: number;
  errors: string[];
}

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export async function runScan(trigger: "MANUAL" | "SCHEDULED", options: { onlyUserId?: string } = {}): Promise<ScanSummary> {
  const run = await db.scanRun.create({ data: { trigger } });
  const errors: string[] = [];
  let jobsFound = 0;
  let jobsNew = 0;

  // 1. Read the sources.
  const sources = await db.jobSource.findMany({ where: { enabled: true } });
  const newJobIds: string[] = [];
  for (const source of sources) {
    const kind = source.kind as SourceKind;
    const connector = kind in connectors ? connectors[kind] : null;
    if (!connector || !sourceReady(kind)) {
      errors.push(`${source.name}: ${connector ? "API keys not set" : `unknown kind ${source.kind}`}`);
      continue;
    }
    let found: FoundJob[];
    try {
      found = await connector((source.config ?? {}) as SourceConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${source.name}: ${message}`);
      await db.jobSource.update({ where: { id: source.id }, data: { lastError: message, lastScanAt: new Date() } });
      continue;
    }
    jobsFound += found.length;
    const seen = new Date();
    for (const job of found) {
      const existing = await db.job.findUnique({ where: { sourceId_externalId: { sourceId: source.id, externalId: job.externalId } }, select: { id: true } });
      if (existing) {
        await db.job.update({ where: { id: existing.id }, data: { lastSeenAt: seen, closedAt: null, salary: job.salary || undefined, url: job.url } });
      } else {
        const created = await db.job.create({
          data: {
            sourceId: source.id,
            externalId: job.externalId,
            title: job.title.slice(0, 300),
            company: job.company.slice(0, 200),
            location: job.location.slice(0, 300),
            remote: job.remote,
            url: job.url,
            description: job.description.slice(0, 60_000),
            salary: job.salary.slice(0, 200),
            postedAt: job.postedAt,
            lastSeenAt: seen,
          },
        });
        newJobIds.push(created.id);
        jobsNew += 1;
      }
    }
    // Adverts that were on the board last time and aren't now have closed.
    await db.job.updateMany({ where: { sourceId: source.id, lastSeenAt: { lt: seen }, closedAt: null }, data: { closedAt: seen } });
    await db.jobSource.update({ where: { id: source.id }, data: { lastScanAt: seen, lastError: null } });
  }

  // 2. Score for each user. New jobs for everyone; for the user who pressed
  // "scan now" (or anyone with no matches yet), every open job, so changed
  // preferences take effect straight away.
  const users = await db.user.findMany({
    where: options.onlyUserId ? { id: options.onlyUserId } : { preferences: { dailyScan: true } },
    include: { preferences: true, profile: true },
  });
  let matchesNew = 0;
  let draftsNew = 0;
  for (const user of users) {
    if (!user.preferences) continue;
    const prefs: MatchPreferences = {
      keywords: strings(user.preferences.keywords),
      excludeKeywords: strings(user.preferences.excludeKeywords),
      locations: strings(user.preferences.locations),
      levels: strings(user.preferences.levels),
      areas: strings(user.preferences.areas),
    };
    const rescoreAll = options.onlyUserId === user.id || (await db.match.count({ where: { userId: user.id } })) === 0;
    const jobs = await db.job.findMany({
      where: rescoreAll ? { closedAt: null } : { id: { in: newJobIds } },
      select: { id: true, title: true, description: true, location: true, remote: true, company: true },
    });
    const readyDrafts: { id: string; title: string; company: string }[] = [];
    for (const job of jobs) {
      const result = scoreJob(job, prefs);
      const existing = await db.match.findUnique({ where: { userId_jobId: { userId: user.id, jobId: job.id } } });
      if (result.excluded || result.score < user.preferences.minScore) {
        // Keep a decision the person made; drop a stale automatic match.
        if (existing && existing.status === "NEW") await db.match.delete({ where: { id: existing.id } });
        continue;
      }
      if (existing) {
        await db.match.update({ where: { id: existing.id }, data: { score: result.score, reasons: result.reasons } });
      } else {
        await db.match.create({ data: { userId: user.id, jobId: job.id, score: result.score, reasons: result.reasons } });
        matchesNew += 1;
      }
      const alreadyDrafted = await db.application.findUnique({ where: { userId_jobId: { userId: user.id, jobId: job.id } }, select: { id: true } });
      if (!alreadyDrafted && result.score >= DRAFT_THRESHOLD && existing?.status !== "DISMISSED") {
        try {
          const app = await prepareDraft(user.id, job.id, { autoApprove: user.preferences.autoApprove });
          draftsNew += 1;
          readyDrafts.push({ id: app.id, title: job.title, company: job.company });
        } catch (error) {
          errors.push(`Draft for ${user.email} / ${job.title}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (readyDrafts.length > 0 && user.preferences.reviewEmails && trigger === "SCHEDULED") {
      await sendMail({
        to: user.email,
        subject: `${readyDrafts.length} new application draft${readyDrafts.length === 1 ? "" : "s"} to review`,
        ...simpleEmail({
          title: "New drafts are ready",
          paragraphs: [
            `Hi ${user.firstName},`,
            `Applya prepared ${readyDrafts.length} tailored draft${readyDrafts.length === 1 ? "" : "s"} today:`,
            ...readyDrafts.slice(0, 10).map((d) => `• ${d.title} at ${d.company}`),
            "Review each CV and message, then approve the ones you want to send.",
          ],
          button: { label: "Review drafts", url: `${siteUrl()}/app/applications?status=IN_REVIEW` },
        }),
      });
    }
  }

  await db.scanRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), jobsFound, jobsNew, matchesNew, draftsNew, errors },
  });
  return { runId: run.id, jobsFound, jobsNew, matchesNew, draftsNew, errors };
}
