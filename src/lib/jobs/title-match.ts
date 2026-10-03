// Is a page heading the same vacancy as an advert title? Shared by the
// employer-site search and the browser, which checks before applying.

const SENIORITY = ["senior", "junior", "graduate", "trainee", "intern", "lead", "head", "chief", "director", "manager", "principal", "associate", "assistant", "apprentice", "partner", "qualified", "nearly", "newly", "part-qualified", "student"];

function words(s: string) {
  return s
    .toLowerCase()
    .split(/\s[–—-]\s|\(|,|\||:/)[0]
    .replace(/[^a-z0-9 -]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** True when the heading carries the title's words and no seniority the title lacks. */
export function titleMatches(title: string, heading: string) {
  const t = words(title);
  const h = new Set(words(heading));
  if (!t.length || !h.size) return false;
  const hits = t.filter((w) => h.has(w)).length / t.length;
  if (hits < 0.6) return false;
  const tSet = new Set(t);
  const extra = SENIORITY.filter((w) => h.has(w) && !tSet.has(w));
  return extra.length === 0;
}
