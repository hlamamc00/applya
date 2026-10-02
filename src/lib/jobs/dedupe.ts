// The same vacancy turns up on several boards, in several feeds of the same
// board, and again when an agency re-posts it. These keys tell copies apart
// from new adverts.

const NOISE = /\b(multiple|various|locations?|uk|united kingdom|england|scotland|wales|hybrid|remote|flexible|permanent|full[- ]time|part[- ]time|contract|london|birmingham|manchester|bristol|edinburgh|leeds|glasgow|reigate|ipswich|norwich|all levels welcome|new|urgent)\b/g;

/** An advert URL without tracking, protocol, host prefix or trailing noise. */
export function canonicalUrl(url: string) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^(www|m|uk)\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Title and employer with locations, punctuation and filler removed. */
export function jobFingerprint(title: string, company: string) {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .split(/\s[–—-]\s|\(|\||,/)[0]
      .replace(NOISE, " ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const co = clean(company).replace(/\b(ltd|plc|limited|llp|group|uk|recruitment|consulting|consultancy|partners|associates|the)\b/g, " ").replace(/\s+/g, " ").trim();
  return `${clean(title)}|${co}`;
}

/** Groups of adverts that are the same vacancy: [the copy to keep, ...the others]. */
export async function duplicateGroups() {
  const { db } = await import("../db");
  const jobs = await db.job.findMany({ select: { id: true, url: true, title: true, company: true, firstSeenAt: true, _count: { select: { applications: true } } }, orderBy: { firstSeenAt: "asc" } });
  const groups = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const keys = [`u:${canonicalUrl(j.url)}`, ...(j.company && j.company !== "See advert" ? [`p:${jobFingerprint(j.title, j.company)}`] : [])];
    for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  const taken = new Set<string>();
  const out: (typeof jobs)[] = [];
  for (const list of groups.values()) {
    const live = list.filter((j) => !taken.has(j.id));
    if (live.length < 2) continue;
    // Keep the copy with applications, else the one seen first.
    const keep = live.find((j) => j._count.applications > 0) ?? live[0];
    const others = live.filter((j) => j.id !== keep.id);
    others.forEach((j) => taken.add(j.id));
    out.push([keep, ...others]);
  }
  return out;
}

/**
 * Folds duplicate adverts into one: matches move to the kept copy, and a
 * copy that already has applications is left alone so nothing is lost.
 */
export async function mergeDuplicateJobs() {
  const { db } = await import("../db");
  let removed = 0;
  for (const [keep, ...others] of await duplicateGroups()) {
    for (const dup of others) {
      if (dup._count.applications > 0) continue;
      const keptFor = new Set((await db.match.findMany({ where: { jobId: keep.id }, select: { userId: true } })).map((m) => m.userId));
      const moving = await db.match.findMany({ where: { jobId: dup.id }, select: { id: true, userId: true } });
      await db.$transaction([
        db.match.updateMany({ where: { id: { in: moving.filter((m) => !keptFor.has(m.userId)).map((m) => m.id) } }, data: { jobId: keep.id } }),
        db.job.delete({ where: { id: dup.id } }),
      ]);
      removed += 1;
    }
  }
  return removed;
}
