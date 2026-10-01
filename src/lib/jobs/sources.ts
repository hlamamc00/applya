import "server-only";
import type { SourceKind } from "@/lib/types";

// One connector per kind of source. Each returns the adverts a source lists
// right now, in one shape, so the scanner never needs to know where a job
// came from. ATS boards (Greenhouse, Lever, Ashby, Workable) are public and
// need no key: the source's config holds the company's board token. The
// aggregators (Adzuna, Reed) take a search query from the config and the API
// keys from .env.

export interface FoundJob {
  externalId: string;
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
}

const UA = "Applya/1.0 (+https://applya.co.uk)";

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", "user-agent": UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
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

export const connectors: Record<SourceKind, (config: SourceConfig) => Promise<FoundJob[]>> = {
  GREENHOUSE: greenhouse,
  LEVER: lever,
  ASHBY: ashby,
  WORKABLE: workable,
  ADZUNA: adzuna,
  REED: reed,
};

/** Whether a source can run with the keys currently set. */
export function sourceReady(kind: SourceKind) {
  if (kind === "ADZUNA") return Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  if (kind === "REED") return Boolean(process.env.REED_API_KEY);
  return true;
}
