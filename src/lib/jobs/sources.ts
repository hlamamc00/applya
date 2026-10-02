import "server-only";
import type { SourceKind } from "@/lib/types";

// One connector per kind of source. Each returns the adverts a source lists
// right now, in one shape, so the scanner never needs to know where a job
// came from.
//
//   - ATS boards (Greenhouse, Lever, Ashby, Workable) are public and need no
//     key: the config holds the company's board token.
//   - RSS reads any job board's feed (most Madgex boards such as
//     theactuaryjobs.com have /jobsrss/); REED_RSS searches reed.co.uk by
//     keyword, also without a key.
//   - The keyed aggregators (Adzuna, Reed API, JSearch for Google for Jobs,
//     Jooble, Careerjet) take search terms from the config and keys from .env.
//
// Feeds only carry a summary, so the scanner asks enrichJob() for the full
// advert from the job page (its schema.org JobPosting when it has one).

export interface FoundJob {
  externalId: string;
  /** How the advert says to apply, when its page says. */
  applyEmail?: string;
  applyUrl?: string;
  applyKind?: "EMAIL" | "FORM" | "UNKNOWN";
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  description: string;
  salary: string;
  postedAt: Date | null;
}

export interface SourceConfig {
  /** Greenhouse board token, Lever/Ashby/Workable company slug. */
  token?: string;
  /** Aggregators: the search terms, e.g. "actuarial". */
  query?: string;
  /** Aggregators: where, e.g. "UK" or "London". */
  where?: string;
  /** Aggregators: how many days back to look (default 7). */
  days?: number;
  /** Company name to show when the board's data doesn't carry one. */
  company?: string;
  /** RSS: the feed URL. "{page}" in it is replaced by 1, 2, 3 for paged feeds. */
  url?: string;
  /** RSS: how many pages to read (default 3). */
  pages?: number;
  /** Set when discovery or a user's keywords added the source rather than an admin. */
  auto?: boolean;
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const UA = "Applya/1.0 (+https://applya.co.uk)";

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", "user-agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

/** HTML to readable plain text, keeping line breaks where the advert had them. */
export function htmlToText(html: string) {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const isRemote = (s: string) => /\bremote\b|work from home|home[- ]based/i.test(s);
const date = (v: unknown) => {
  const d = v ? new Date(v as string) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// --- Greenhouse -------------------------------------------------------------

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  content?: string;
  company_name?: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
}

async function greenhouse(config: SourceConfig): Promise<FoundJob[]> {
  const token = config.token?.trim();
  if (!token) throw new Error("Greenhouse source needs a board token");
  const data = await getJson<{ jobs: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`);
  return data.jobs.map((j) => {
    // The content field is HTML-escaped HTML.
    const html = htmlToText(j.content ?? "");
    const location = j.location?.name ?? "";
    return {
      externalId: String(j.id),
      title: j.title,
      company: j.company_name || config.company || token,
      location,
      remote: isRemote(location) || isRemote(j.title),
      url: j.absolute_url,
      description: htmlToText(html),
      salary: "",
      postedAt: date(j.first_published) ?? date(j.updated_at),
    };
  });
}

// --- Lever ------------------------------------------------------------------

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  descriptionPlain?: string;
  description?: string;
  categories?: { location?: string; commitment?: string; team?: string; allLocations?: string[] };
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  lists?: { text: string; content: string }[];
}

async function lever(config: SourceConfig): Promise<FoundJob[]> {
  const token = config.token?.trim();
  if (!token) throw new Error("Lever source needs a company slug");
  const data = await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`);
  return data.map((j) => {
    const lists = (j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
    const location = j.categories?.allLocations?.join(" / ") || j.categories?.location || "";
    const s = j.salaryRange;
    return {
      externalId: j.id,
      title: j.text,
      company: config.company || token,
      location,
      remote: j.workplaceType === "remote" || isRemote(location),
      url: j.hostedUrl,
      description: [j.descriptionPlain ?? htmlToText(j.description ?? ""), lists].filter(Boolean).join("\n\n"),
      salary: s?.min && s?.max ? `${s.currency ?? ""} ${s.min.toLocaleString()} – ${s.max.toLocaleString()} ${s.interval ?? ""}`.trim() : "",
      postedAt: j.createdAt ? new Date(j.createdAt) : null,
    };
  });
}

// --- Ashby ------------------------------------------------------------------

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  jobUrl: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  isListed?: boolean;
  compensation?: { compensationTierSummary?: string };
}

async function ashby(config: SourceConfig): Promise<FoundJob[]> {
  const token = config.token?.trim();
  if (!token) throw new Error("Ashby source needs a job board name");
  const data = await getJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`);
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean).join(" / ");
      return {
        externalId: j.id,
        title: j.title,
        company: config.company || token,
        location,
        remote: Boolean(j.isRemote) || isRemote(location),
        url: j.jobUrl,
        description: j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? ""),
        salary: j.compensation?.compensationTierSummary ?? "",
        postedAt: date(j.publishedAt),
      };
    });
}

// --- Workable ---------------------------------------------------------------

interface WorkableJob {
  shortcode: string;
  title: string;
  url: string;
  application_url?: string;
  published_on?: string;
  city?: string;
  country?: string;
  telecommuting?: boolean;
  description?: string;
}

async function workable(config: SourceConfig): Promise<FoundJob[]> {
  const token = config.token?.trim();
  if (!token) throw new Error("Workable source needs an account subdomain");
  const data = await getJson<{ name?: string; jobs: WorkableJob[] }>(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}`);
  const jobs: FoundJob[] = [];
  for (const j of data.jobs) {
    // The listing has no description; each job is one more request.
    let description = j.description ?? "";
    if (!description) {
      try {
        const detail = await getJson<{ description?: string; requirements?: string; benefits?: string }>(
          `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}/jobs/${encodeURIComponent(j.shortcode)}`,
        );
        description = [detail.description, detail.requirements, detail.benefits].filter(Boolean).join("\n\n");
      } catch {
        description = "";
      }
    }
    const location = [j.city, j.country].filter(Boolean).join(", ");
    jobs.push({
      externalId: j.shortcode,
      title: j.title,
      company: data.name || config.company || token,
      location,
      remote: Boolean(j.telecommuting) || isRemote(location),
      url: j.url,
      description: htmlToText(description),
      salary: "",
      postedAt: date(j.published_on),
    });
  }
  return jobs;
}

// --- Adzuna (needs ADZUNA_APP_ID / ADZUNA_APP_KEY) ---------------------------

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
}

async function adzuna(config: SourceConfig): Promise<FoundJob[]> {
  const id = process.env.ADZUNA_APP_ID?.trim();
  const key = process.env.ADZUNA_APP_KEY?.trim();
  if (!id || !key) throw new Error("ADZUNA_APP_ID and ADZUNA_APP_KEY are not set");
  const jobs: FoundJob[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const params = new URLSearchParams({
      app_id: id,
      app_key: key,
      results_per_page: "50",
      what: config.query ?? "",
      max_days_old: String(config.days ?? 7),
      "content-type": "application/json",
    });
    if (config.where) params.set("where", config.where);
    const data = await getJson<{ results: AdzunaJob[] }>(`https://api.adzuna.com/v1/api/jobs/gb/search/${page}?${params}`);
    for (const j of data.results) {
      const location = j.location?.display_name ?? "";
      jobs.push({
        externalId: String(j.id),
        title: j.title.replace(/<[^>]+>/g, ""),
        company: j.company?.display_name ?? "Unknown employer",
        location,
        remote: isRemote(location) || isRemote(j.title),
        url: j.redirect_url,
        description: htmlToText(j.description),
        salary: j.salary_min && j.salary_max ? `£${Math.round(j.salary_min).toLocaleString()} – £${Math.round(j.salary_max).toLocaleString()}` : "",
        postedAt: date(j.created),
      });
    }
    if (data.results.length < 50) break;
  }
  return jobs;
}

// --- Reed (needs REED_API_KEY) ----------------------------------------------

interface ReedJob {
  jobId: number;
  jobTitle: string;
  employerName?: string;
  locationName?: string;
  minimumSalary?: number;
  maximumSalary?: number;
  date?: string;
  jobDescription?: string;
  jobUrl: string;
}

async function reed(config: SourceConfig): Promise<FoundJob[]> {
  const key = process.env.REED_API_KEY?.trim();
  if (!key) throw new Error("REED_API_KEY is not set");
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const jobs: FoundJob[] = [];
  for (let skip = 0; skip < 300; skip += 100) {
    const params = new URLSearchParams({ keywords: config.query ?? "", resultsToTake: "100", resultsToSkip: String(skip) });
    if (config.where) params.set("locationName", config.where);
    const data = await getJson<{ results: ReedJob[] }>(`https://www.reed.co.uk/api/1.0/search?${params}`, { headers: { authorization: auth } });
    const cutoff = Date.now() - (config.days ?? 7) * 86_400_000;
    for (const j of data.results) {
      // Reed dates are dd/MM/yyyy.
      const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(j.date ?? "");
      const posted = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
      if (posted && posted.getTime() < cutoff) continue;
      const location = j.locationName ?? "";
      jobs.push({
        externalId: String(j.jobId),
        title: j.jobTitle,
        company: j.employerName ?? "Unknown employer",
        location,
        remote: isRemote(location) || isRemote(j.jobTitle),
        url: j.jobUrl,
        description: htmlToText(j.jobDescription ?? ""),
        salary: j.minimumSalary && j.maximumSalary ? `£${Math.round(j.minimumSalary).toLocaleString()} – £${Math.round(j.maximumSalary).toLocaleString()}` : "",
        postedAt: posted,
      });
    }
    if (data.results.length < 100) break;
  }
  return jobs;
}

// --- RSS / Atom feeds (no key) ------------------------------------------------

interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  date: Date | null;
}

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml);
  if (!m) return "";
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
};

/** The items of an RSS 2.0 or Atom feed, without an XML library. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks) {
    const atomLink = /<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? "";
    const link = htmlToText(tag(block, "link")) || atomLink;
    const title = htmlToText(tag(block, "title"));
    if (!link || !title) continue;
    const guid = htmlToText(tag(block, "guid") || tag(block, "id")) || link;
    const date = tag(block, "pubDate") || tag(block, "a10:updated") || tag(block, "updated") || tag(block, "published") || tag(block, "dc:date");
    items.push({
      id: guid.replace(/[?#].*$/, ""),
      title,
      link: link.replace(/[?&](utm_[a-z]+|TrackID)=[^&]*/gi, "").replace(/\?$/, ""),
      description: htmlToText(tag(block, "description") || tag(block, "summary") || tag(block, "content")),
      date: date ? (() => { const d = new Date(date); return Number.isNaN(d.getTime()) ? null : d; })() : null,
    });
  }
  return items;
}

async function fetchFeed(url: string) {
  const res = await fetch(url, { headers: { "user-agent": BROWSER_UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  const text = await res.text();
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text)) throw new Error(`${new URL(url).host} did not return a feed`);
  return text;
}

/** "The Pensions Regulator: Actuarial Modeller" → company + title, as Madgex boards write them. */
function splitFeedTitle(title: string, fallbackCompany: string) {
  const m = /^(.{2,60}?):\s+(.+)$/.exec(title);
  return m ? { company: m[1].trim(), title: m[2].trim() } : { company: fallbackCompany, title };
}

async function rss(config: SourceConfig): Promise<FoundJob[]> {
  const url = config.url?.trim();
  if (!url) throw new Error("RSS source needs a feed URL");
  const pages = url.includes("{page}") ? Math.min(10, Math.max(1, config.pages ?? 3)) : 1;
  const host = new URL(url.replace("{page}", "1")).host.replace(/^www\./, "");
  const jobs: FoundJob[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= pages; page += 1) {
    const items = parseFeed(await fetchFeed(url.replace("{page}", String(page))));
    let added = 0;
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      added += 1;
      const { company, title } = splitFeedTitle(item.title, config.company || host);
      // Madgex feeds put the salary first: "£50,980 Per Annum:  Employer: ...".
      const salary = /^\s*(£[^:]{2,40}?)\s*:/.exec(item.description)?.[1] ?? "";
      jobs.push({
        externalId: item.id,
        title,
        company,
        location: "",
        remote: /\bremote\b/i.test(`${title} ${item.description}`),
        url: item.link,
        description: item.description,
        salary,
        postedAt: item.date,
      });
    }
    if (added === 0) break;
  }
  return jobs;
}

/** reed.co.uk's public search feed: UK-wide, no key, 25 per page. */
async function reedRss(config: SourceConfig): Promise<FoundJob[]> {
  const query = config.query?.trim();
  if (!query) throw new Error("Reed search needs search terms");
  const params = new URLSearchParams({ keywords: query });
  if (config.where) params.set("location", config.where);
  const jobs = await rss({ ...config, url: `https://www.reed.co.uk/jobs/rss?${params}&pageno={page}`, pages: config.pages ?? 4, company: "" });
  return jobs.map((j) => ({ ...j, company: j.company === "reed.co.uk" ? "See advert" : j.company }));
}

// --- Keyed aggregators -------------------------------------------------------

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name?: string;
  job_city?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_apply_link: string;
  job_description?: string;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number;
  job_max_salary?: number;
  job_salary_period?: string;
  job_publisher?: string;
}

/** JSearch (RapidAPI) reads Google for Jobs: LinkedIn, Indeed, Glassdoor, employer sites and more. */
async function jsearch(config: SourceConfig): Promise<FoundJob[]> {
  const key = process.env.RAPIDAPI_KEY?.trim();
  if (!key) throw new Error("RAPIDAPI_KEY is not set");
  const jobs: FoundJob[] = [];
  const days = config.days ?? 7;
  const params = new URLSearchParams({
    query: `${config.query ?? ""} in ${config.where || "United Kingdom"}`,
    page: "1",
    num_pages: "3",
    country: "gb",
    date_posted: days <= 1 ? "today" : days <= 3 ? "3days" : days <= 7 ? "week" : "month",
  });
  const data = await getJson<{ data: JSearchJob[] }>(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: { "x-rapidapi-key": key, "x-rapidapi-host": "jsearch.p.rapidapi.com" },
  });
  for (const j of data.data ?? []) {
    const location = [j.job_city, j.job_country].filter(Boolean).join(", ");
    jobs.push({
      externalId: j.job_id,
      title: j.job_title,
      company: j.employer_name || "Unknown employer",
      location,
      remote: Boolean(j.job_is_remote) || isRemote(location),
      url: j.job_apply_link,
      description: j.job_description ?? "",
      salary: j.job_min_salary && j.job_max_salary ? `${Math.round(j.job_min_salary).toLocaleString()} – ${Math.round(j.job_max_salary).toLocaleString()} ${j.job_salary_period?.toLowerCase() ?? ""}`.trim() : "",
      postedAt: date(j.job_posted_at_datetime_utc),
    });
  }
  return jobs;
}

interface JoobleJob {
  id: string | number;
  title: string;
  company?: string;
  location?: string;
  link: string;
  snippet?: string;
  salary?: string;
  updated?: string;
}

async function jooble(config: SourceConfig): Promise<FoundJob[]> {
  const key = process.env.JOOBLE_API_KEY?.trim();
  if (!key) throw new Error("JOOBLE_API_KEY is not set");
  const jobs: FoundJob[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const data = await getJson<{ jobs: JoobleJob[] }>(`https://uk.jooble.org/api/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keywords: config.query ?? "", location: config.where ?? "", page, datecreatedfrom: new Date(Date.now() - (config.days ?? 7) * 86_400_000).toISOString().slice(0, 10) }),
    });
    for (const j of data.jobs ?? []) {
      const location = j.location ?? "";
      jobs.push({ externalId: String(j.id), title: j.title, company: j.company || "Unknown employer", location, remote: isRemote(location) || isRemote(j.title), url: j.link, description: htmlToText(j.snippet ?? ""), salary: j.salary ?? "", postedAt: date(j.updated) });
    }
    if ((data.jobs ?? []).length < 20) break;
  }
  return jobs;
}

interface CareerjetJob {
  title: string;
  company?: string;
  locations?: string;
  url: string;
  description?: string;
  salary?: string;
  date?: string;
}

async function careerjet(config: SourceConfig): Promise<FoundJob[]> {
  const key = process.env.CAREERJET_API_KEY?.trim();
  if (!key) throw new Error("CAREERJET_API_KEY is not set");
  const jobs: FoundJob[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const params = new URLSearchParams({ affid: key, keywords: config.query ?? "", location: config.where ?? "United Kingdom", locale_code: "en_GB", pagesize: "50", page: String(page), sort: "date", user_ip: "127.0.0.1", user_agent: UA, url: "https://applya.co.uk" });
    const data = await getJson<{ jobs?: CareerjetJob[]; pages?: number }>(`https://public.api.careerjet.net/search?${params}`);
    for (const j of data.jobs ?? []) {
      const location = j.locations ?? "";
      jobs.push({ externalId: j.url.replace(/^https?:\/\//, "").slice(0, 190), title: j.title, company: j.company || "Unknown employer", location, remote: isRemote(location) || isRemote(j.title), url: j.url, description: htmlToText(j.description ?? ""), salary: j.salary ?? "", postedAt: date(j.date) });
    }
    if (!data.pages || page >= data.pages) break;
  }
  return jobs;
}

export const connectors: Record<SourceKind, (config: SourceConfig) => Promise<FoundJob[]>> = {
  GREENHOUSE: greenhouse,
  LEVER: lever,
  ASHBY: ashby,
  WORKABLE: workable,
  RSS: rss,
  REED_RSS: reedRss,
  ADZUNA: adzuna,
  REED: reed,
  JSEARCH: jsearch,
  JOOBLE: jooble,
  CAREERJET: careerjet,
};

/** The .env variable(s) a kind needs, if any. */
export const SOURCE_KEYS: Partial<Record<SourceKind, string[]>> = {
  ADZUNA: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
  REED: ["REED_API_KEY"],
  JSEARCH: ["RAPIDAPI_KEY"],
  JOOBLE: ["JOOBLE_API_KEY"],
  CAREERJET: ["CAREERJET_API_KEY"],
};

/** Whether a source can run with the keys currently set. */
export function sourceReady(kind: SourceKind) {
  return (SOURCE_KEYS[kind] ?? []).every((k) => Boolean(process.env[k]?.trim()));
}

// --- Reading the advert itself ----------------------------------------------

interface JobLocation {
  address?: string | { addressLocality?: string; addressRegion?: string; addressCountry?: string };
}

interface JobPosting {
  title?: string;
  directApply?: boolean;
  url?: string;
  description?: string;
  datePosted?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: JobLocation | JobLocation[];
  jobLocationType?: string;
  baseSalary?: { value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string }; currency?: string };
}

function findJobPosting(html: string): JobPosting | null {
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const list = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [])];
      const posting = list.find((x) => x && (x["@type"] === "JobPosting" || (Array.isArray(x["@type"]) && x["@type"].includes("JobPosting"))));
      if (posting) return posting as JobPosting;
    } catch {
      // not JSON we can use; try the next block
    }
  }
  return null;
}

/**
 * How the advert says to apply: an email address next to "apply"/"CV"/"send",
 * a mailto: link, or the link/button that leads to the form.
 */
export function detectApply(html: string, text: string, pageUrl: string): { applyEmail?: string; applyUrl?: string; applyKind: "EMAIL" | "FORM" | "UNKNOWN" } {
  const mailto = /href="mailto:([^"?]+)/i.exec(html)?.[1];
  const nearApply =
    /(?:apply|applications?|send (?:your|a) cv|cv|résumé|resume)[^.\n]{0,100}?(?:to|at|via|by emailing|email(?:ing)?)?[^.\n]{0,40}?([\w.+-]+@[\w-]+\.[\w.-]+)/i.exec(text)?.[1] ??
    /([\w.+-]+@[\w-]+\.[\w.-]+)[^.\n]{0,60}?(?:with your cv|with a cv|to apply|your application)/i.exec(text)?.[1];
  const email = (mailto ?? nearApply)?.toLowerCase();
  const context = email ? (new RegExp(`.{0,80}${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").exec(text)?.[0] ?? "") : "";
  const generic = email && (/^(no-?reply|privacy|info@|support@|press@|media@|dpo@|unsubscribe)/.test(email) || (/question|quer|enquir|contact|informal (chat|discussion)|further information|more information|find out more/i.test(context) && !/apply|application|cv/i.test(context)));
  if (email && !generic && !/\.(png|jpg|gif|svg)$/i.test(email)) return { applyEmail: email, applyKind: "EMAIL" };
  // A link whose text says apply, skipping "alert", "save", "sign in" style controls.
  for (const m of html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
    const label = htmlToText(m[2]).toLowerCase();
    if (!/\bapply\b/.test(label) || /alert|save|sign in|log in|register|share|email this/.test(label)) continue;
    try {
      const url = new URL(m[1].replace(/&amp;/g, "&"), pageUrl).href;
      if (!/^https?:/.test(url)) continue;
      return { applyUrl: url, applyKind: "FORM" };
    } catch {
      // not a URL
    }
  }
  if (/<input[^>]+type="file"/i.test(html) || /<form[^>]+(apply|application)/i.test(html)) return { applyUrl: pageUrl, applyKind: "FORM" };
  return { applyKind: "UNKNOWN" };
}

/** The readable text of a page, favouring its main content. */
export function pageText(html: string) {
  const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ?? /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return htmlToText(main.replace(/<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")).slice(0, 20_000);
}

/**
 * Fills in what a feed left out by reading the advert's own page: the full
 * description, employer, location and salary from its schema.org JobPosting
 * where there is one, else the page's text. Never throws: on any failure the
 * job is returned as it was.
 */
export async function enrichJob(job: FoundJob): Promise<FoundJob> {
  try {
    const res = await fetch(job.url, { headers: { "user-agent": BROWSER_UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return job;
    const html = await res.text();
    const posting = findJobPosting(html);
    if (posting) {
      const org = typeof posting.hiringOrganization === "string" ? posting.hiringOrganization : posting.hiringOrganization?.name;
      const loc = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation;
      const address = loc?.address;
      const location = typeof address === "string" ? address : [address?.addressLocality, address?.addressRegion, address?.addressCountry].filter(Boolean).join(", ");
      const sal = posting.baseSalary?.value;
      const salary =
        sal && (sal.minValue || sal.maxValue || sal.value)
          ? `${posting.baseSalary?.currency === "GBP" ? "£" : (posting.baseSalary?.currency ?? "") + " "}${(sal.minValue ?? sal.value ?? 0).toLocaleString()}${sal.maxValue ? ` – £${sal.maxValue.toLocaleString()}` : ""}${sal.unitText ? ` per ${sal.unitText.toLowerCase()}` : ""}`
          : "";
      const description = htmlToText(posting.description ?? "");
      const apply = detectApply(html, `${description}\n${pageText(html)}`, job.url);
      return {
        ...job,
        ...apply,
        title: posting.title?.trim() || job.title,
        company: org?.trim() || job.company,
        location: location || job.location,
        remote: job.remote || posting.jobLocationType === "TELECOMMUTE" || isRemote(location),
        description: description.length > job.description.length ? description : job.description,
        salary: job.salary || salary,
        postedAt: job.postedAt ?? date(posting.datePosted),
      };
    }
    const text = pageText(html);
    const apply = detectApply(html, text, job.url);
    return { ...job, ...apply, description: text.length > job.description.length * 2 ? text : job.description };
  } catch {
    return job;
  }
}

/** Feeds carry only a summary, so their jobs are worth a visit to the advert. */
export function needsEnrichment(kind: SourceKind) {
  return kind === "RSS" || kind === "REED_RSS" || kind === "JOOBLE" || kind === "CAREERJET";
}
