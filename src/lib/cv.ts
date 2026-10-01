// The shapes of the JSON sections on Profile, and the frozen CvDocument a
// CvVersion holds. The layout follows the order that works best for a
// professional-qualification field: contact, a short tailored profile, exam
// progress, skills, then experience (reverse chronological) and education.

export interface CvLink {
  label: string;
  url: string;
}

export interface CvQualification {
  /** Awarding body, e.g. "IFoA". */
  body: string;
  /** Exam or qualification, e.g. "CS1 Actuarial Statistics". */
  name: string;
  status: "PASSED" | "PENDING" | "PLANNED";
  /** Free text: "Apr 2025", "result due Dec 2026". */
  date: string;
}

export interface CvSkillGroup {
  group: string;
  items: string[];
}

export interface CvExperience {
  title: string;
  employer: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
}

export interface CvEducation {
  institution: string;
  qualification: string;
  grade: string;
  start: string;
  end: string;
  notes: string;
}

export interface CvSection {
  title: string;
  items: string[];
}

export interface CvDocument {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: CvLink[];
  summary: string;
  qualifications: CvQualification[];
  skills: CvSkillGroup[];
  experience: CvExperience[];
  education: CvEducation[];
  extraSections: CvSection[];
}

type ProfileLike = {
  headline: string;
  summary: string;
  phone: string;
  contactEmail?: string;
  location: string;
  links: unknown;
  qualifications: unknown;
  skills: unknown;
  experience: unknown;
  education: unknown;
  extraSections: unknown;
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** The CV as the profile stands today, before any tailoring. */
export function cvFromProfile(user: { firstName: string; lastName: string; email: string }, profile: ProfileLike): CvDocument {
  return {
    name: `${user.firstName} ${user.lastName}`.trim(),
    headline: profile.headline,
    email: profile.contactEmail?.trim() || user.email,
    phone: profile.phone,
    location: profile.location,
    links: asArray<CvLink>(profile.links),
    summary: profile.summary,
    qualifications: asArray<CvQualification>(profile.qualifications),
    skills: asArray<CvSkillGroup>(profile.skills),
    experience: asArray<CvExperience>(profile.experience),
    education: asArray<CvEducation>(profile.education),
    extraSections: asArray<CvSection>(profile.extraSections),
  };
}

export function parseCv(value: unknown): CvDocument {
  const v = (value ?? {}) as Partial<CvDocument>;
  return {
    name: v.name ?? "",
    headline: v.headline ?? "",
    email: v.email ?? "",
    phone: v.phone ?? "",
    location: v.location ?? "",
    links: asArray<CvLink>(v.links),
    summary: v.summary ?? "",
    qualifications: asArray<CvQualification>(v.qualifications),
    skills: asArray<CvSkillGroup>(v.skills),
    experience: asArray<CvExperience>(v.experience),
    education: asArray<CvEducation>(v.education),
    extraSections: asArray<CvSection>(v.extraSections),
  };
}

/** Plain text of the CV, for AI prompts and keyword matching. */
export function cvToText(cv: CvDocument) {
  const out: string[] = [];
  if (cv.headline) out.push(cv.headline);
  if (cv.summary) out.push(cv.summary);
  for (const q of cv.qualifications) out.push(`${q.body} ${q.name} (${q.status.toLowerCase()}${q.date ? `, ${q.date}` : ""})`);
  for (const g of cv.skills) out.push(`${g.group}: ${g.items.join(", ")}`);
  for (const e of cv.experience) {
    out.push(`${e.title}, ${e.employer}${e.location ? `, ${e.location}` : ""} (${e.start} – ${e.current ? "present" : e.end})`);
    out.push(...e.bullets.map((b) => `- ${b}`));
  }
  for (const e of cv.education) out.push(`${e.qualification}, ${e.institution}${e.grade ? ` (${e.grade})` : ""} ${e.start} – ${e.end}`);
  for (const s of cv.extraSections) out.push(`${s.title}: ${s.items.join("; ")}`);
  return out.join("\n");
}

export function isProfileUsable(profile: ProfileLike | null) {
  if (!profile) return false;
  return Boolean(profile.summary.trim()) && asArray(profile.experience).length + asArray(profile.education).length > 0;
}

// --- Presentation helpers shared by the PDF and the on-screen preview -------

const norm = (s: string) => s.trim().toLowerCase();

/** The contact line: location, phone, email and links, each once. Email addresses saved as "links" are dropped. */
export function contactItems(cv: CvDocument): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: string) => {
    const t = v.trim();
    const key = norm(t.replace(/^mailto:/i, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""));
    if (!t || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  add(cv.location);
  add(cv.phone);
  add(cv.email);
  for (const l of cv.links) {
    const url = l.url.trim();
    if (!url || url.includes("@")) continue;
    add(url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""));
  }
  return out;
}

/** "CS1 Actuarial Statistics" → "CS1"; names without an exam code are kept whole. */
function shortExamName(name: string) {
  const code = /^\s*([A-Z]{1,4}\d{1,3}[A-Z]?)\b/.exec(name);
  return code ? code[1] : name.trim();
}

export interface QualificationLine {
  body: string;
  /** e.g. ["Passed: CM1, CS1, CB1", "Results awaited: CP3, CS2"] */
  parts: string[];
}

/** Exams grouped by awarding body, one line each: no dates, codes rather than full titles. */
export function qualificationLines(cv: CvDocument): QualificationLine[] {
  const bodies = new Map<string, CvQualification[]>();
  for (const q of cv.qualifications) {
    if (!q.name.trim()) continue;
    const body = q.body.trim() || "Qualifications";
    bodies.set(body, [...(bodies.get(body) ?? []), q]);
  }
  const labels: Record<CvQualification["status"], string> = { PASSED: "Passed", PENDING: "Results awaited", PLANNED: "Planned" };
  return [...bodies.entries()].map(([body, items]) => ({
    body,
    parts: (["PASSED", "PENDING", "PLANNED"] as const)
      .map((status) => {
        const names = [...new Set(items.filter((q) => q.status === status).map((q) => shortExamName(q.name)))];
        return names.length ? `${labels[status]}: ${names.join(", ")}` : "";
      })
      .filter(Boolean),
  }));
}

const groupWords = (g: string) => new Set(norm(g).split(/[^a-z0-9]+/).filter((w) => w && w !== "and"));

/**
 * Skill groups as printed: a group whose name is contained in another's
 * ("Technology" in "Data & Technology", "Actuarial" in "Pensions &
 * Actuarial") is folded into it, and repeated items are dropped.
 */
export function mergedSkills(skills: CvSkillGroup[]): CvSkillGroup[] {
  const groups = skills.map((g) => ({ group: g.group.trim(), items: [...g.items] })).filter((g) => g.items.some((i) => i.trim()));
  const merged: CvSkillGroup[] = [];
  for (const g of groups) {
    const words = groupWords(g.group);
    const into = merged.find((m) => {
      const mw = groupWords(m.group);
      if (!words.size || !mw.size) return norm(m.group) === norm(g.group);
      return [...words].every((w) => mw.has(w)) || [...mw].every((w) => words.has(w));
    });
    if (into) {
      // Keep the longer, more descriptive name.
      if (g.group.length > into.group.length) into.group = g.group;
      into.items.push(...g.items);
    } else {
      merged.push(g);
    }
  }
  const seenItems = new Set<string>();
  return merged
    .map((g) => ({
      group: g.group,
      items: g.items.map((i) => i.trim()).filter((i) => {
        const k = norm(i);
        if (!k || seenItems.has(k)) return false;
        seenItems.add(k);
        return true;
      }),
    }))
    .filter((g) => g.items.length);
}
