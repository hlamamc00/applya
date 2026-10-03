import "server-only";
import { braveSearch } from "./discover";
import { titleMatches } from "./title-match";

// The same vacancy is often advertised on the employer's or agency's own
// site, where applying needs no job-board account. Given a job from a board,
// find those pages so the browser can apply there first and fall back to
// the board.

const BOARDS = /reed\.co\.uk|indeed\.|totaljobs|cv-library|linkedin\.com|glassdoor|theactuaryjobs|efinancialcareers|jobsite\.co|adzuna|jooble|careerjet|monster\.|jobserve|cwjobs|technojobs|milkround|gradcracker|targetjobs|google\.com|facebook\.com|twitter\.com|x\.com|youtube\.com|wikipedia|jobs\.ac\.uk/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(and|the|for|with|our|you|job|jobs|role|vacancy|london|hybrid|remote|multiple|locations|senior|junior|ltd|plc|limited|group|uk)$/.test(w));
}

/** Pages on the employer's or agency's own site that carry this vacancy, best first. */
export async function findAlternativeAdverts(job: { url: string; title: string; company: string }, budgetMs = 12_000): Promise<string[]> {
  if (!process.env.BRAVE_SEARCH_API_KEY?.trim() || !job.company) return [];
  const started = Date.now();
  const advertHost = new URL(job.url).hostname.replace(/^www\./, "");
  const companyWords = tokens(job.company);
  const titleWords = tokens(job.title);
  if (!companyWords.length || !titleWords.length) return [];
  // "Actuarial Analyst, Birmingham (Hybrid) - Multiple UK Locations" → "Actuarial Analyst"
  const cleanTitle = job.title.split(/\s[–—-]\s|\(|,|\|/)[0].replace(/\b(multiple|uk|locations?|hybrid|remote|london|birmingham|manchester|bristol|edinburgh|leeds|glasgow)\b/gi, " ").replace(/\s+/g, " ").trim() || job.title;
  const queries = [`"${cleanTitle}" ${job.company} careers`, `${job.company} careers "${cleanTitle}"`];
  const seen = new Set<string>();
  const ownHosts = new Set<string>();
  const candidates: { url: string; score: number }[] = [];
  const consider = (results: { url: string; title: string }[]) => {
    for (const r of results) {
      let host: string;
      try {
        host = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        continue;
      }
      if (host === advertHost || BOARDS.test(host) || seen.has(r.url) || /\/(blog|news|insights?|articles?|events?|about|salary-guide)s?\//i.test(r.url)) continue;
      seen.add(r.url);
      const text = `${r.title} ${r.url}`.toLowerCase();
      const titleHits = titleWords.filter((w) => text.includes(w)).length / titleWords.length;
      // Only their own site: another aggregator is no better than the board.
      const own = companyWords.some((w) => w.length >= 3 && host.replace(/[^a-z0-9]/g, "").includes(w));
      if (!own) continue;
      ownHosts.add(host);
      if (titleHits < 0.5) continue;
      candidates.push({ url: r.url, score: (/\/(job|jobs|careers?|vacanc|position|opening)s?\//i.test(r.url) ? 10 : 0) + titleHits * 5 });
    }
  };
  for (const q of queries) {
    if (Date.now() - started > budgetMs * 0.4) break;
    consider(await braveSearch(q).catch(() => []));
  }
  // Search engines keep expired adverts around: ask the employer's own site for live ones too.
  for (const host of [...ownHosts].slice(0, 2)) {
    if (Date.now() - started > budgetMs * 0.6) break;
    consider(await braveSearch(`site:${host} ${cleanTitle}`, { freshness: "pm" }).catch(() => []));
  }
  candidates.sort((a, b) => b.score - a.score);
  // Check the page really carries the vacancy before offering it.
  const confirmed: string[] = [];
  for (const c of candidates.slice(0, 6)) {
    if (Date.now() - started > budgetMs) break;
    try {
      const res = await fetch(c.url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(5_000) });
      if (!res.ok) continue;
      const html = await res.text();
      const heading = `${/<title[^>]*>([^<]*)/i.exec(html)?.[1] ?? ""} ${/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, " ") ?? ""}`.toLowerCase();
      const isAdvert = /"@type"\s*:\s*"JobPosting"/i.test(html) || />\s*apply\b[^<]{0,40}</i.test(html) || /<title[^>]*>[^<]*\bapply\b/i.test(html) || /<input[^>]+type="file"/i.test(html);
      if (titleMatches(job.title, heading) && isAdvert) confirmed.push(c.url);
    } catch {
      // Unreachable or slow: not a route worth sending the browser down.
    }
    if (confirmed.length >= 2) break;
  }
  return confirmed;
}
