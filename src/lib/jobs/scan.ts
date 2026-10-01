import "server-only";
import { db } from "@/lib/db";
import type { SourceKind } from "@/lib/types";
import { connectors, enrichJob, needsEnrichment, sourceReady, type FoundJob, type SourceConfig } from "./sources";
import { DRAFT_THRESHOLD, scoreJob, type MatchPreferences } from "./matching";
import { prepareDraft } from "@/lib/applications";
import { applyEmailFor, canApplyOnSite, startSiteApply, submitByEmail } from "@/lib/apply";
import { sendMail, simpleEmail, siteUrl } from "@/lib/mail";

// One scan: read every enabled source, store the adverts, read the advert
// pages that feeds only summarised, score every open advert for each user
// with daily scanning on, and prepare drafts for their strongest matches.
//
// A whole scan takes minutes, which is longer than one serverless call may
// run, so it is done in steps. scanStep() does up to `budgetMs` of work on
// the current run and records where it got to in ScanRun.progress; whoever
// drives the scan (the background function on Netlify, runScan() in a
// terminal) calls it again until done.

export interface ScanSummary {
  runId: string;
  done: boolean;
  phase: string;
  jobsFound: number;
  jobsNew: number;
  matchesNew: number;
  draftsNew: number;
  errors: string[];
}

interface PendingDraft {
  userId: string;
  jobId: string;
  score: number;
  title: string;
  company: string;
}

interface Progress {
  onlyUserId?: string;
  sourcesDone: string[];
  newJobIds: string[];
  usersDone: string[];
  pendingDrafts: PendingDraft[];
  readyDrafts: Record<string, { title: string; company: string }[]>;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** How many drafts one scan prepares for one person: the strongest matches, so a big first scan doesn't bury them. */
const DRAFTS_PER_SCAN = 12;
/** A run nobody has touched for this long is abandoned and a new one started. */
const STALE_MINUTES = 30;

const emptyProgress = (onlyUserId?: string): Progress => ({ onlyUserId, sourcesDone: [], newJobIds: [], usersDone: [], pendingDrafts: [], readyDrafts: {} });

async function currentRun(trigger: "MANUAL" | "SCHEDULED", onlyUserId?: string) {
  const running = await db.scanRun.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } });
  if (running) {
    if (running.updatedAt.getTime() > Date.now() - STALE_MINUTES * 60_000) return running;
    await db.scanRun.update({ where: { id: running.id }, data: { status: "FAILED", finishedAt: new Date(), errors: [...strings(running.errors), "Abandoned: no progress for 30 minutes"] } });
  }
  return db.scanRun.create({ data: { trigger, progress: emptyProgress(onlyUserId) as object } });
}

/**
 * Does up to budgetMs of work on the current run (starting one if none is
 * running) and returns where things stand. Safe to call again at any time.
 */
export async function scanStep(trigger: "MANUAL" | "SCHEDULED", options: { onlyUserId?: string; budgetMs?: number } = {}): Promise<ScanSummary> {
  const deadline = Date.now() + (options.budgetMs ?? 15_000);
  const timeLeft = () => deadline - Date.now();
  let run = await currentRun(trigger, options.onlyUserId);
  const progress = { ...emptyProgress(), ...((run.progress ?? {}) as Partial<Progress>) } as Progress;
  const errors = strings(run.errors);
  let { jobsFound, jobsNew, matchesNew, draftsNew, phase } = run;

  const save = async (extra: { status?: string; finishedAt?: Date } = {}) => {
    run = await db.scanRun.update({ where: { id: run.id }, data: { phase, progress: progress as object, errors, jobsFound, jobsNew, matchesNew, draftsNew, ...extra } });
  };

  try {
    // --- SOURCES: read each source and store its adverts ---------------------
    while (phase === "SOURCES" && timeLeft() > 3_000) {
      const source = await db.jobSource.findFirst({ where: { enabled: true, id: { notIn: progress.sourcesDone } }, orderBy: { name: "asc" } });
      if (!source) {
        phase = "ENRICH";
        await save();
        break;
      }
      progress.sourcesDone.push(source.id);
      const kind = source.kind as SourceKind;
      const connector = kind in connectors ? connectors[kind] : null;
      if (!connector || !sourceReady(kind)) {
        errors.push(`${source.name}: ${connector ? "API keys not set" : `unknown kind ${source.kind}`}`);
        await save();
        continue;
      }
      let found: FoundJob[];
      try {
        found = await connector((source.config ?? {}) as SourceConfig);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${source.name}: ${message}`);
        await db.jobSource.update({ where: { id: source.id }, data: { lastError: message, lastScanAt: new Date() } });
        await save();
        continue;
      }
      jobsFound += found.length;
      const seen = new Date();
      // What the same source already holds, and what any source holds open
      // (the same advert often appears on several boards; the first copy wins).
      const mine = new Map((await db.job.findMany({ where: { sourceId: source.id }, select: { id: true, externalId: true } })).map((j) => [j.externalId, j.id]));
      const elsewhere = new Set(
        (await db.job.findMany({ where: { closedAt: null, sourceId: { not: source.id } }, select: { title: true, company: true } })).map((j) => `${j.title.trim().toLowerCase()}|${j.company.trim().toLowerCase()}`),
      );
      for (const job of found) {
        const existingId = mine.get(job.externalId);
        if (existingId) {
          await db.job.update({ where: { id: existingId }, data: { lastSeenAt: seen, closedAt: null, salary: job.salary || undefined, url: job.url } });
          continue;
        }
        if (job.company !== "See advert" && elsewhere.has(`${job.title.trim().toLowerCase()}|${job.company.trim().toLowerCase()}`)) continue;
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
            enrichedAt: needsEnrichment(kind) ? null : seen,
          },
          select: { id: true },
        });
        mine.set(job.externalId, created.id);
        progress.newJobIds.push(created.id);
        jobsNew += 1;
      }
      // Adverts that were on the board last time and aren't now have closed.
      await db.job.updateMany({ where: { sourceId: source.id, lastSeenAt: { lt: seen }, closedAt: null }, data: { closedAt: seen } });
      await db.jobSource.update({ where: { id: source.id }, data: { lastScanAt: seen, lastError: null } });
      await save();
    }

    // --- ENRICH: read the advert pages feeds only summarised -----------------
    // Each advert page is given 8 seconds, so one is only started with that in hand.
    while (phase === "ENRICH" && timeLeft() > 9_000) {
      const batch = await db.job.findMany({ where: { enrichedAt: null, closedAt: null }, orderBy: { firstSeenAt: "desc" }, take: 8 });
      if (batch.length === 0) {
        phase = "SCORE";
        await save();
        break;
      }
      for (const job of batch) {
        if (timeLeft() < 9_000) break;
        const full = await enrichJob({ externalId: job.externalId, title: job.title, company: job.company, location: job.location, remote: job.remote, url: job.url, description: job.description, salary: job.salary, postedAt: job.postedAt });
        // Written per advert, so a cut-off step loses at most one page's work.
        await db.job.update({
          where: { id: job.id },
          data: { title: full.title.slice(0, 300), company: full.company.slice(0, 200), location: full.location.slice(0, 300), remote: full.remote, description: full.description.slice(0, 60_000), salary: full.salary.slice(0, 200), postedAt: full.postedAt, enrichedAt: new Date(), applyEmail: full.applyEmail ?? null, applyUrl: full.applyUrl ?? null, applyKind: full.applyKind ?? null },
        });
      }
      await save();
    }

    // --- SCORE: one user per pass, all queries batched -----------------------
    while (phase === "SCORE" && timeLeft() > 5_000) {
      const user = await db.user.findFirst({
        where: progress.onlyUserId ? { id: progress.onlyUserId, NOT: { id: { in: progress.usersDone } } } : { id: { notIn: progress.usersDone }, preferences: { dailyScan: true } },
        include: { preferences: true },
        orderBy: { createdAt: "asc" },
      });
      if (!user) {
        phase = "DRAFTS";
        await save();
        break;
      }
      progress.usersDone.push(user.id);
      if (!user.preferences) {
        await save();
        continue;
      }
      const prefs: MatchPreferences = {
        keywords: strings(user.preferences.keywords),
        excludeKeywords: strings(user.preferences.excludeKeywords),
        locations: strings(user.preferences.locations),
        levels: strings(user.preferences.levels),
        areas: strings(user.preferences.areas),
      };
      const existingMatches = new Map((await db.match.findMany({ where: { userId: user.id } })).map((m) => [m.jobId, m]));
      const applied = new Set((await db.application.findMany({ where: { userId: user.id }, select: { jobId: true } })).map((a) => a.jobId));
      // New adverts for everyone; every open advert for the person who pressed
      // "scan now" (or has no matches yet), so changed preferences take effect.
      const rescoreAll = progress.onlyUserId === user.id || existingMatches.size === 0;
      const jobs = await db.job.findMany({
        where: rescoreAll ? { closedAt: null } : { id: { in: progress.newJobIds } },
        select: { id: true, title: true, description: true, location: true, remote: true, company: true },
      });
      const toCreate: { userId: string; jobId: string; score: number; reasons: string[] }[] = [];
      const toDelete: string[] = [];
      const draftable: PendingDraft[] = [];
      for (const job of jobs) {
        const result = scoreJob(job, prefs);
        const existing = existingMatches.get(job.id);
        if (result.excluded || result.score < user.preferences.minScore) {
          if (existing && existing.status === "NEW") toDelete.push(existing.id);
          continue;
        }
        if (existing) {
          if (existing.score !== result.score) await db.match.update({ where: { id: existing.id }, data: { score: result.score, reasons: result.reasons } });
        } else {
          toCreate.push({ userId: user.id, jobId: job.id, score: result.score, reasons: result.reasons });
        }
        if (!applied.has(job.id) && result.score >= DRAFT_THRESHOLD && existing?.status !== "DISMISSED") {
          draftable.push({ userId: user.id, jobId: job.id, score: result.score, title: job.title, company: job.company });
        }
      }
      if (toCreate.length) await db.match.createMany({ data: toCreate, skipDuplicates: true });
      if (toDelete.length) await db.match.deleteMany({ where: { id: { in: toDelete } } });
      matchesNew += toCreate.length;
      draftable.sort((a, b) => b.score - a.score);
      progress.pendingDrafts.push(...draftable.slice(0, DRAFTS_PER_SCAN));
      await save();
    }

    // --- DRAFTS: tailor one application at a time ----------------------------
    while (phase === "DRAFTS") {
      const next = progress.pendingDrafts[0];
      if (!next) {
        phase = "DONE";
        break;
      }
      // Tailoring with AI can take a while; only start one with time in hand.
      if (timeLeft() < 10_000) break;
      progress.pendingDrafts.shift();
      try {
        const prefs = await db.preference.findUnique({ where: { userId: next.userId }, select: { autoApprove: true, autoSubmit: true } });
        const app = await prepareDraft(next.userId, next.jobId, { autoApprove: prefs?.autoApprove });
        draftsNew += 1;
        if (prefs?.autoApprove && prefs.autoSubmit) {
          const job = await db.job.findUniqueOrThrow({ where: { id: next.jobId } });
          const mailbox = await db.mailAccount.findUnique({ where: { userId: next.userId }, select: { id: true } });
          const to = applyEmailFor(job, { applyEmail: null });
          if (to && mailbox) await submitByEmail(app.id, to);
          else if (canApplyOnSite(job)) await startSiteApply(app.id, "LIVE");
        }
        (progress.readyDrafts[next.userId] ??= []).push({ title: next.title, company: next.company });
      } catch (error) {
        errors.push(`Draft for ${next.title}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await save();
    }

    if (phase === "DONE") {
      if (run.trigger === "SCHEDULED") await sendReviewEmails(progress.readyDrafts);
      await save({ status: "DONE", finishedAt: new Date() });
    } else {
      await save();
    }
  } catch (error) {
    errors.push(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    await save({ status: "FAILED", finishedAt: new Date() });
    return { runId: run.id, done: true, phase, jobsFound, jobsNew, matchesNew, draftsNew, errors };
  }

  return { runId: run.id, done: phase === "DONE", phase, jobsFound, jobsNew, matchesNew, draftsNew, errors };
}

async function sendReviewEmails(readyDrafts: Record<string, { title: string; company: string }[]>) {
  for (const [userId, drafts] of Object.entries(readyDrafts)) {
    if (drafts.length === 0) continue;
    const user = await db.user.findUnique({ where: { id: userId }, include: { preferences: { select: { reviewEmails: true } } } });
    if (!user || !user.preferences?.reviewEmails) continue;
    await sendMail({
      to: user.email,
      subject: `${drafts.length} new application draft${drafts.length === 1 ? "" : "s"} to review`,
      ...simpleEmail({
        title: "New drafts are ready",
        paragraphs: [
          `Hi ${user.firstName},`,
          `Applya prepared ${drafts.length} tailored draft${drafts.length === 1 ? "" : "s"} today:`,
          ...drafts.slice(0, 10).map((d) => `• ${d.title} at ${d.company}`),
          "Review each CV and message, then approve the ones you want to send.",
        ],
        button: { label: "Review drafts", url: `${siteUrl()}/app/applications?status=IN_REVIEW` },
      }),
    });
  }
}

/** Runs a whole scan to completion, step after step. For terminals and local development. */
export async function runScan(trigger: "MANUAL" | "SCHEDULED", options: { onlyUserId?: string } = {}): Promise<ScanSummary> {
  let summary = await scanStep(trigger, { ...options, budgetMs: 60_000 });
  while (!summary.done) summary = await scanStep(trigger, { ...options, budgetMs: 60_000 });
  return summary;
}

/** Whether a scan is in progress right now. */
export async function scanInProgress() {
  const running = await db.scanRun.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } });
  return running && running.updatedAt.getTime() > Date.now() - STALE_MINUTES * 60_000 ? running : null;
}

/**
 * Starts a scan the right way for where the app runs: on Netlify the
 * background function drives it (a request may only run ~25 seconds); anywhere
 * else it runs here and now.
 */
export async function startScan(trigger: "MANUAL" | "SCHEDULED", options: { onlyUserId?: string } = {}): Promise<{ started: boolean; message: string; summary?: ScanSummary }> {
  if (await scanInProgress()) return { started: false, message: "A scan is already running. New matches appear as it goes; check back in a few minutes." };
  if (process.env.NETLIFY && process.env.CRON_SECRET) {
    const params = options.onlyUserId ? `?user=${encodeURIComponent(options.onlyUserId)}` : "";
    // The site's own netlify.app address works whatever state the custom domain is in.
    const internal = process.env.SITE_NAME ? `https://${process.env.SITE_NAME}.netlify.app` : siteUrl();
    const res = await fetch(`${internal}/.netlify/functions/scan-background${params}`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, "x-trigger": trigger } });
    if (res.status !== 202 && !res.ok) return { started: false, message: `The scan couldn't be started (${res.status}).` };
    return { started: true, message: "Scan started. It runs in the background for a few minutes; refresh this page to see new matches and drafts as they arrive." };
  }
  const summary = await runScan(trigger, options);
  const errors = summary.errors.length ? ` ${summary.errors.length} source${summary.errors.length === 1 ? "" : "s"} couldn't be read.` : "";
  return { started: true, summary, message: `Scan finished: ${summary.jobsFound} adverts read, ${summary.jobsNew} new, ${summary.matchesNew} new matches, ${summary.draftsNew} drafts prepared.${errors}` };
}
