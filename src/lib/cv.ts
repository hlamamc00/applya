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
    email: user.email,
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
