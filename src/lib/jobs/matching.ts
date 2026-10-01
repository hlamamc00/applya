// Scores a job against one user's preferences: 0–100 with the reasons shown
// on the match. Pure, so the same function serves the scanner and the tests.

import type { JobLevel } from "@/lib/types";

export interface MatchPreferences {
  keywords: string[];
  excludeKeywords: string[];
  locations: string[];
  levels: string[];
  areas: string[];
}

export interface MatchableJob {
  title: string;
  description: string;
  location: string;
  remote: boolean;
  company: string;
}

export interface MatchResult {
  score: number;
  reasons: string[];
  /** True when an exclusion or a hard location miss rules the job out. */
  excluded: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
const has = (haystack: string, needle: string) => {
  const n = norm(needle).trim();
  if (!n) return false;
  // Whole-word match so "actuary" doesn't fire on "actuarial"? It should: use
  // a prefix-tolerant boundary on the left only.
  return new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(haystack);
};

const UK_WORDS = ["united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "london", "manchester", "birmingham", "leeds", "edinburgh", "glasgow", "bristol", "cardiff", "belfast", "reading", "surrey", "kent", "home based", "hybrid"];

const LEVEL_SIGNALS: Record<JobLevel, RegExp> = {
  ENTRY: /\b(entry[- ]level|junior|assistant|associate|analyst|student)\b/i,
  GRADUATE: /\b(graduate|trainee|intern|placement|apprentice|early careers?)\b/i,
  PART_QUALIFIED: /\b(part[- ]qualified|nearly qualified|student actuar|actuarial (analyst|trainee|student)|exam support|study support)\b/i,
  MID: /\b(mid[- ]level|experienced|specialist|consultant|manager|qualified)\b/i,
  SENIOR: /\b(senior|lead|principal|head of|director|chief|vp|vice president)\b/i,
};

const SENIOR_ONLY = /\b(head of|director|chief|partner|vp|vice president|principal)\b/i;

export function scoreJob(job: MatchableJob, prefs: MatchPreferences): MatchResult {
  const title = norm(job.title);
  const text = norm(`${job.title}\n${job.description}`);
  const location = norm(`${job.location} ${job.remote ? "remote" : ""}`);
  const reasons: string[] = [];

  for (const word of prefs.excludeKeywords) {
    if (has(title, word)) return { score: 0, reasons: [`Title contains "${word}"`], excluded: true };
  }

  let score = 0;

  // Keywords: the title is worth far more than a mention in the body.
  const titleHits = prefs.keywords.filter((k) => has(title, k));
  const bodyHits = prefs.keywords.filter((k) => !has(title, k) && has(text, k));
  if (prefs.keywords.length === 0) {
    score += 30;
  } else if (titleHits.length > 0) {
    score += 45;
    reasons.push(`Title mentions ${titleHits.map((k) => `"${k}"`).join(", ")}`);
  } else if (bodyHits.length > 0) {
    score += 18;
    reasons.push(`Advert mentions ${bodyHits.slice(0, 3).map((k) => `"${k}"`).join(", ")}`);
  } else {
    return { score: 0, reasons: ["None of your keywords appear"], excluded: true };
  }

  // Location.
  if (prefs.locations.length === 0) {
    score += 15;
  } else {
    const wantsRemote = prefs.locations.some((l) => norm(l) === "remote");
    const wantsUk = prefs.locations.some((l) => ["united kingdom", "uk", "great britain", "britain"].includes(norm(l)));
    const direct = prefs.locations.filter((l) => norm(l) !== "remote" && has(location, l));
    const ukMatch = wantsUk && (UK_WORDS.some((w) => has(location, w)) || location.trim() === "");
    if (direct.length > 0) {
      score += 20;
      reasons.push(`Located in ${direct[0]}`);
    } else if (wantsRemote && job.remote) {
      score += 18;
      reasons.push("Remote role");
    } else if (ukMatch) {
      score += 15;
      reasons.push(location.trim() ? "UK based" : "Location not stated");
    } else if (location.trim() === "") {
      score += 8;
      reasons.push("Location not stated");
    } else {
      return { score: 0, reasons: [`Located in ${job.location}, outside your locations`], excluded: true };
    }
  }

  // Level.
  if (prefs.levels.length === 0) {
    score += 15;
  } else {
    const matched = prefs.levels.filter((l) => LEVEL_SIGNALS[l as JobLevel]?.test(job.title));
    const matchedBody = matched.length === 0 ? prefs.levels.filter((l) => LEVEL_SIGNALS[l as JobLevel]?.test(job.description)) : [];
    const seniorOnly = SENIOR_ONLY.test(job.title) && !prefs.levels.includes("SENIOR");
    if (seniorOnly) {
      score -= 25;
      reasons.push("Looks like a senior role");
    } else if (matched.length > 0) {
      score += 20;
      reasons.push("Level fits the title");
    } else if (matchedBody.length > 0) {
      score += 10;
      reasons.push("Level mentioned in the advert");
    } else {
      score += 5;
    }
  }

  // Areas of interest: a bonus, never a penalty.
  const areaHits = prefs.areas.filter((a) => has(text, a));
  if (areaHits.length > 0) {
    score += Math.min(15, 6 * areaHits.length);
    reasons.push(`Covers ${areaHits.slice(0, 3).join(", ")}`);
  }

  // Study support is a strong signal for a part-qualified candidate.
  if (/study support|exam support|study package|actuarial study/i.test(job.description)) {
    score += 5;
    reasons.push("Mentions study support");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons, excluded: false };
}

/** The score from which a draft application is prepared without being asked. */
export const DRAFT_THRESHOLD = 70;
