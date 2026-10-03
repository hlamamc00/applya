import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { BOARD_KINDS, type SourceKind } from "@/lib/types";
import { connectors, sourceReady, type SourceConfig } from "./sources";

// Finds places to read jobs from for a field, beyond the sources an admin
// typed in. Three ways, used together when their keys are set:
//
//   1. Keyword searches that need no key: a reed.co.uk feed per keyword.
//   2. A web search for employers' ATS boards and job-board feeds, through
//      Claude's web_search tool (ANTHROPIC_API_KEY) and/or the Brave Search
//      API (BRAVE_SEARCH_API_KEY).
//   3. Every candidate is tried for real before it is saved, so a source
//      that is added is one that returned jobs.

export interface Candidate {
  kind: SourceKind;
  name: string;
  config: SourceConfig;
  /** Where the suggestion came from, for the report. */
  via: string;
}

export interface DiscoveryReport {
  added: { name: string; kind: SourceKind; jobs: number }[];
  alreadyThere: string[];
  rejected: { name: string; reason: string }[];
  notes: string[];
}

const ATS_PATTERNS: { kind: SourceKind; re: RegExp }[] = [
  { kind: "GREENHOUSE", re: /(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { kind: "GREENHOUSE", re: /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/i },
  { kind: "LEVER", re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { kind: "ASHBY", re: /jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i },
  { kind: "WORKABLE", re: /apply\.workable\.com\/([a-z0-9_-]+)/i },
];

/** An ATS board token read off a careers URL, if the URL is one. */
export function boardFromUrl(url: string): { kind: SourceKind; token: string } | null {
  for (const { kind, re } of ATS_PATTERNS) {
    const m = re.exec(url);
    if (m && !["embed", "jobs", "job", "api", "v1"].includes(m[1].toLowerCase())) return { kind, token: m[1].toLowerCase() };
  }
  return null;
}

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** 1. Keyword feeds that need no key. */
/**
 * One search per keyword on every aggregator whose key is set. Google for
 * Jobs (JSearch) is how Indeed, Glassdoor and LinkedIn adverts get in: none
 * of those three offers a jobs API and all sit behind bot walls.
 */
export function keywordCandidates(keywords: string[], where?: string): Candidate[] {
  const place = where ? ` in ${where}` : " (UK)";
  const engines: { kind: SourceKind; label: string }[] = [
    { kind: "REED_RSS", label: "Reed" },
    { kind: "ADZUNA", label: "Adzuna" },
    { kind: "JSEARCH", label: "Google for Jobs" },
    { kind: "LINKEDIN", label: "LinkedIn" },
    { kind: "JOOBLE", label: "Jooble" },
    { kind: "CAREERJET", label: "Careerjet" },
  ];
  return keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 8)
    .flatMap((k) =>
      engines
        .filter((e) => sourceReady(e.kind))
        .map((e) => ({ kind: e.kind, name: `${e.label}: ${k}${e.kind === "REED_RSS" && !where ? "" : place}`, config: { query: k, where: where || undefined, days: 7, auto: true }, via: "keyword" })),
    );
}

/** "Quantity Surveying " → "quantity surveying". */
export function normaliseField(field: string) {
  return field.toLowerCase().replace(/[^a-z0-9 &/-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Queues web discovery for a field nobody has asked for before. True when it was new. */
export async function queueFieldDiscovery(field: string, userId?: string) {
  const key = normaliseField(field);
  if (!key) return false;
  const existing = await db.fieldDiscovery.findUnique({ where: { field: key } });
  if (existing) return false;
  await db.fieldDiscovery.create({ data: { field: key, requestedBy: userId ?? null } });
  return true;
}

/**
 * Runs discovery for the fields still pending, within a time budget; a field
 * stays pending while candidates remain unchecked, so it finishes over a few
 * scans. Returns how many fields were worked on.
 */
export async function runPendingFieldDiscovery(budgetMs: number) {
  const started = Date.now();
  let worked = 0;
  const pending = await db.fieldDiscovery.findMany({ where: { status: "PENDING", attempts: { lt: 6 } }, orderBy: { createdAt: "asc" }, take: 3 });
  for (const f of pending) {
    const left = budgetMs - (Date.now() - started);
    if (left < 8_000) break;
    const prefs = await db.preference.findMany({ where: { field: { contains: f.field, mode: "insensitive" } }, select: { keywords: true } });
    const keywords = [...new Set(prefs.flatMap((p) => (Array.isArray(p.keywords) ? p.keywords.map(String) : [])))];
    const report = await discoverSources({ field: f.field, keywords: keywords.length ? keywords : [f.field], userId: f.requestedBy ?? undefined, useWeb: true, budgetMs: Math.min(left - 2_000, 25_000) }).catch((error) => ({ added: [], alreadyThere: [], rejected: [], notes: [`failed: ${error instanceof Error ? error.message : String(error)}`] }));
    const unfinished = report.notes.some((n) => /weren't checked in time/.test(n));
    await db.fieldDiscovery.update({
      where: { id: f.id },
      data: { attempts: { increment: 1 }, sourcesAdded: { increment: report.added.length }, notes: report.notes.slice(0, 10), status: unfinished && f.attempts < 5 ? "PENDING" : "DONE", finishedAt: unfinished && f.attempts < 5 ? null : new Date() },
    });
    worked += 1;
  }
  return worked;
}

/**
 * Every member's keywords get a search on every keyed aggregator, so new
 * keywords (and newly added keys) take effect at the next scan without
 * anyone pressing "Find sources".
 */
export async function ensureKeywordSources() {
  const prefs = await db.preference.findMany({ select: { keywords: true, locations: true } });
  const existing = new Set((await db.jobSource.findMany({ select: { kind: true, name: true } })).map((s) => `${s.kind}|${s.name}`));
  let created = 0;
  for (const p of prefs) {
    const keywords = Array.isArray(p.keywords) ? p.keywords.map(String) : [];
    for (const c of keywordCandidates(keywords)) {
      const k = `${c.kind}|${c.name}`;
      if (existing.has(k)) continue;
      existing.add(k);
      await db.jobSource.create({ data: { kind: c.kind, name: c.name, config: { ...c.config, via: c.via }, createdById: null } });
      created += 1;
    }
  }
  return created;
}

// --- 2a. Brave Search -------------------------------------------------------

interface BraveResult {
  web?: { results?: { url: string; title: string }[] };
}

export async function braveSearch(query: string, options: { freshness?: "pd" | "pw" | "pm" } = {}): Promise<{ url: string; title: string }[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return [];
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: "20", country: "GB", ...(options.freshness ? { freshness: options.freshness } : {}) })}`, {
    headers: { accept: "application/json", "x-subscription-token": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as BraveResult;
  return data.web?.results ?? [];
}

export async function braveCandidates(field: string): Promise<Candidate[]> {
  if (!process.env.BRAVE_SEARCH_API_KEY?.trim()) return [];
  const queries = [
    `"${field}" jobs site:job-boards.greenhouse.io OR site:boards.greenhouse.io`,
    `"${field}" jobs site:jobs.lever.co`,
    `"${field}" jobs site:jobs.ashbyhq.com OR site:apply.workable.com`,
    `"${field}" jobs uk rss feed`,
  ];
  const out: Candidate[] = [];
  for (const q of queries) {
    for (const r of await braveSearch(q)) {
      const board = boardFromUrl(r.url);
      if (board) out.push({ kind: board.kind, name: titleCase(board.token), config: { token: board.token, company: titleCase(board.token) }, via: "web search" });
      else if (/rss|feed|\.xml/i.test(r.url)) out.push({ kind: "RSS", name: r.title.slice(0, 80) || new URL(r.url).host, config: { url: r.url, auto: true }, via: "web search" });
    }
  }
  return out;
}

// --- 2b. Claude with web search ----------------------------------------------

const claudeResult = z.object({
  sources: z
    .array(
      z.object({
        kind: z.enum(["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE", "RSS"]),
        name: z.string().max(100),
        token: z.string().max(100).optional(),
        url: z.string().max(500).optional(),
        company: z.string().max(100).optional(),
      }),
    )
    .max(40),
  notes: z.array(z.string().max(300)).max(10).optional(),
});

export async function claudeCandidates(field: string, where: string): Promise<{ candidates: Candidate[]; notes: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return { candidates: [], notes: [] };
  const client = new Anthropic();
  const response = await client.messages.create({
    model: process.env.TAILOR_MODEL?.trim() || "claude-opus-5-5",
    max_tokens: 8000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 10 }],
    system: [
      "You find machine-readable places to collect job adverts for one professional field in one country. Use web search.",
      "Wanted: (a) employers in that field whose careers site runs on Greenhouse (job-boards.greenhouse.io/<token> or boards.greenhouse.io/<token>), Lever (jobs.lever.co/<slug>), Ashby (jobs.ashbyhq.com/<name>) or Workable (apply.workable.com/<subdomain>); (b) specialist job boards for the field that publish an RSS feed of adverts (many Madgex-run boards expose /jobsrss/?keywords=).",
      "Only report tokens and URLs you actually saw in search results or on the pages; never guess a token from a company name.",
      'Finish with JSON only: {"sources":[{"kind":"GREENHOUSE|LEVER|ASHBY|WORKABLE|RSS","name":"...","token":"...","url":"...","company":"..."}],"notes":["..."]}. token for boards, url for RSS. No markdown fences.',
    ].join(" "),
    messages: [{ role: "user", content: `Field: ${field}\nCountry / region: ${where || "United Kingdom"}` }],
  });
  if (response.stop_reason === "refusal") return { candidates: [], notes: ["The web search was declined."] };
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const json = /\{[\s\S]*\}\s*$/.exec(text)?.[0];
  if (!json) return { candidates: [], notes: ["The web search returned nothing usable."] };
  const parsed = claudeResult.safeParse(JSON.parse(json));
  if (!parsed.success) return { candidates: [], notes: ["The web search result couldn't be read."] };
  const candidates: Candidate[] = [];
  for (const s of parsed.data.sources) {
    if (s.kind === "RSS") {
      if (s.url) candidates.push({ kind: "RSS", name: s.name, config: { url: s.url, auto: true }, via: "Claude web search" });
    } else {
      const token = (s.token ?? (s.url ? boardFromUrl(s.url)?.token : undefined))?.toLowerCase();
      if (token) candidates.push({ kind: s.kind, name: s.company || s.name || titleCase(token), config: { token, company: s.company || s.name }, via: "Claude web search" });
    }
  }
  return { candidates, notes: parsed.data.notes ?? [] };
}

// --- 3. Try, then save --------------------------------------------------------

function key(c: Candidate) {
  const cfg = c.config;
  return `${c.kind}:${(cfg.token ?? cfg.url ?? cfg.query ?? "").toLowerCase()}`;
}

/** Tries each candidate for real and saves the ones that return jobs. */
/** Rejects after `ms` so one slow service can't eat the whole budget. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`took longer than ${Math.round(ms / 1000)}s`)), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * A request on Netlify may only run about 26 seconds, so discovery works to a
 * budget: the searches run side by side, candidates are probed a few at a
 * time, and whatever wasn't reached is reported for the next press.
 */
export async function discoverSources(opts: { field: string; keywords: string[]; where?: string; userId?: string; useWeb: boolean; budgetMs?: number }): Promise<DiscoveryReport> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const timeLeft = () => budget - (Date.now() - started);
  const report: DiscoveryReport = { added: [], alreadyThere: [], rejected: [], notes: [] };
  const candidates: Candidate[] = [...keywordCandidates(opts.keywords, opts.where)];
  if (opts.useWeb && opts.field.trim()) {
    const searchBudget = Math.min(12_000, budget * 0.5);
    const [fromClaude, fromBrave] = await Promise.allSettled([within(searchBudget, claudeCandidates(opts.field, opts.where ?? "")), within(searchBudget, braveCandidates(opts.field))]);
    if (fromClaude.status === "fulfilled") {
      candidates.push(...fromClaude.value.candidates);
      report.notes.push(...fromClaude.value.notes);
    } else report.notes.push(`Claude web search failed: ${fromClaude.reason instanceof Error ? fromClaude.reason.message : String(fromClaude.reason)}`);
    if (fromBrave.status === "fulfilled") candidates.push(...fromBrave.value);
    else report.notes.push(`Brave search failed: ${fromBrave.reason instanceof Error ? fromBrave.reason.message : String(fromBrave.reason)}`);
    if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.BRAVE_SEARCH_API_KEY?.trim()) {
      report.notes.push("Web discovery needs BRAVE_SEARCH_API_KEY (free) or ANTHROPIC_API_KEY; only keyword feeds were added.");
    }
  }

  const existing = await db.jobSource.findMany({ select: { kind: true, name: true, config: true } });
  const existingKeys = new Set(existing.map((e) => key({ kind: e.kind as SourceKind, name: e.name, config: (e.config ?? {}) as SourceConfig, via: "" })));
  const tried = new Set<string>();
  const fresh: Candidate[] = [];
  for (const c of candidates) {
    const k = key(c);
    if (tried.has(k)) continue;
    tried.add(k);
    if (existingKeys.has(k)) report.alreadyThere.push(c.name);
    else fresh.push(c);
  }
  // Probe a few at a time, each given a slice of what's left.
  let i = 0;
  while (i < fresh.length && timeLeft() > 3_000) {
    const batch = fresh.slice(i, i + 5);
    i += batch.length;
    const probeMs = Math.max(3_000, Math.min(8_000, timeLeft() - 1_000));
    const results = await Promise.allSettled(batch.map((c) => within(probeMs, connectors[c.kind](c.config))));
    for (const [j, c] of batch.entries()) {
      const r = results[j];
      if (r.status === "rejected") {
        report.rejected.push({ name: c.name, reason: r.reason instanceof Error ? r.reason.message : String(r.reason) });
        continue;
      }
      const count = r.value.length;
      if (count === 0 && !BOARD_KINDS.includes(c.kind)) {
        report.rejected.push({ name: c.name, reason: "returned no adverts" });
        continue;
      }
      // A careers board found by web search must actually carry adverts for the field.
      if (BOARD_KINDS.includes(c.kind) && c.via !== "keyword") {
        const words = [opts.field, ...opts.keywords].join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
        const relevant = r.value.filter((j) => words.some((w) => `${j.title} ${j.description}`.toLowerCase().includes(w)));
        if (words.length && relevant.length === 0) {
          report.rejected.push({ name: c.name, reason: `no ${opts.field || "matching"} adverts on it` });
          continue;
        }
      }
      const name = (await db.jobSource.findUnique({ where: { kind_name: { kind: c.kind, name: c.name } } })) ? `${c.name} (${c.config.token ?? c.config.query ?? "feed"})` : c.name;
      await db.jobSource.create({ data: { kind: c.kind, name, config: { ...c.config, auto: true, via: c.via }, createdById: opts.userId ?? null } });
      existingKeys.add(key(c));
      report.added.push({ name, kind: c.kind, jobs: count });
    }
  }
  if (i < fresh.length) report.notes.push(`${fresh.length - i} more candidate${fresh.length - i === 1 ? "" : "s"} weren't checked in time; press Find sources again to carry on.`);
  return report;
}
