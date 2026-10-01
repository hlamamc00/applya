import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { BOARD_KINDS, type SourceKind } from "@/lib/types";
import { connectors, type SourceConfig } from "./sources";

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
export function keywordCandidates(keywords: string[], where?: string): Candidate[] {
  return keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((k) => ({ kind: "REED_RSS" as SourceKind, name: `Reed: ${k}${where ? ` in ${where}` : ""}`, config: { query: k, where: where || undefined, auto: true }, via: "keyword" }));
}

// --- 2a. Brave Search -------------------------------------------------------

interface BraveResult {
  web?: { results?: { url: string; title: string }[] };
}

async function braveSearch(query: string): Promise<{ url: string; title: string }[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return [];
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: "20", country: "GB" })}`, {
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
export async function discoverSources(opts: { field: string; keywords: string[]; where?: string; userId?: string; useWeb: boolean }): Promise<DiscoveryReport> {
  const report: DiscoveryReport = { added: [], alreadyThere: [], rejected: [], notes: [] };
  const candidates: Candidate[] = [...keywordCandidates(opts.keywords, opts.where)];
  if (opts.useWeb && opts.field.trim()) {
    try {
      const fromClaude = await claudeCandidates(opts.field, opts.where ?? "");
      candidates.push(...fromClaude.candidates);
      report.notes.push(...fromClaude.notes);
    } catch (error) {
      report.notes.push(`Claude web search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      candidates.push(...(await braveCandidates(opts.field)));
    } catch (error) {
      report.notes.push(`Brave search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.BRAVE_SEARCH_API_KEY?.trim()) {
      report.notes.push("Web discovery needs ANTHROPIC_API_KEY or BRAVE_SEARCH_API_KEY; only keyword feeds were added.");
    }
  }

  const existing = await db.jobSource.findMany({ select: { kind: true, name: true, config: true } });
  const existingKeys = new Set(existing.map((e) => key({ kind: e.kind as SourceKind, name: e.name, config: (e.config ?? {}) as SourceConfig, via: "" })));
  const tried = new Set<string>();
  for (const c of candidates) {
    const k = key(c);
    if (tried.has(k)) continue;
    tried.add(k);
    if (existingKeys.has(k)) {
      report.alreadyThere.push(c.name);
      continue;
    }
    let count = 0;
    try {
      const jobs = await connectors[c.kind](c.config);
      count = jobs.length;
    } catch (error) {
      report.rejected.push({ name: c.name, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (count === 0 && !BOARD_KINDS.includes(c.kind)) {
      report.rejected.push({ name: c.name, reason: "returned no adverts" });
      continue;
    }
    const name = (await db.jobSource.findUnique({ where: { kind_name: { kind: c.kind, name: c.name } } })) ? `${c.name} (${c.config.token ?? c.config.query ?? "feed"})` : c.name;
    await db.jobSource.create({ data: { kind: c.kind, name, config: { ...c.config, auto: true, via: c.via }, createdById: opts.userId ?? null } });
    existingKeys.add(k);
    report.added.push({ name, kind: c.kind, jobs: count });
  }
  return report;
}
