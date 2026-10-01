import "server-only";
import { aiAvailable, generateJson } from "./llm";
import { z } from "zod";
import type { ProfileInput } from "./actions/profile";

// Reads an uploaded CV (PDF, Word or plain text) and turns it into the
// profile's fields. With an AI provider configured (llm.ts) the model does
// the reading; without one, a section-by-section parser does its best.
// Either way the person reviews the result in the profile editor before it
// is saved.

export type ParsedProfile = Omit<ProfileInput, "aiTailoring" | "salaryMin" | "salaryMax" | "salaryNote" | "visaExpiresAt" | "availability" | "noticePeriod" | "rightToWork"> & {
  /** Which method produced it, for the banner. */
  method: "AI" | "HEURISTIC";
};

export const MAX_CV_BYTES = 5 * 1024 * 1024;

export async function extractCvText(file: { name: string; type: string; bytes: Buffer }): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(file.bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (name.endsWith(".docx") || file.type.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: file.bytes });
    return value;
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return file.bytes.toString("utf8");
  throw new Error("Upload a PDF, Word (.docx) or plain-text CV.");
}

// --- The section parser -----------------------------------------------------

const HEADINGS: { key: keyof Sections; re: RegExp }[] = [
  { key: "summary", re: /^(professional\s+)?(profile|summary|personal\s+statement|about\s+me|objective|overview)\b/i },
  { key: "experience", re: /^(work|professional|employment|relevant)?\s*(experience|employment|history|career)\b/i },
  { key: "education", re: /^(education|academic|qualifications?\s+and\s+education|education\s+and\s+qualifications?)\b/i },
  { key: "qualifications", re: /^(professional\s+)?(qualifications?|exams?|examinations?|certifications?|actuarial\s+exams?|ifoa|accreditations?|professional\s+development|memberships?)\b/i },
  { key: "skills", re: /^(key\s+|technical\s+|core\s+)?(skills?|competenc(y|ies)|technical\s+summary|technologies|tools)\b/i },
  { key: "other", re: /^(interests|hobbies|languages|volunteering|awards|achievements|publications|references|additional\s+information|activities)\b/i },
];

interface Sections {
  header: string[];
  summary: string[];
  experience: string[];
  education: string[];
  qualifications: string[];
  skills: string[];
  other: { title: string; lines: string[] }[];
}

function isHeading(line: string) {
  const t = line.trim().replace(/[:\-–—]+$/, "").trim();
  if (t.length === 0 || t.length > 48) return null;
  const match = HEADINGS.find((h) => h.re.test(t));
  if (!match) return null;
  // A heading is short and on its own line; "Experience in Python" inside a sentence is not.
  if (/[.;,]/.test(t) || t.split(/\s+/).length > 5) return null;
  return { key: match.key, title: t };
}

function splitSections(text: string): Sections {
  const s: Sections = { header: [], summary: [], experience: [], education: [], qualifications: [], skills: [], other: [] };
  let current: keyof Sections | "other" = "header";
  let otherTitle = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const h = isHeading(line);
    if (h) {
      current = h.key;
      if (h.key === "other") {
        otherTitle = h.title;
        s.other.push({ title: otherTitle, lines: [] });
      }
      continue;
    }
    if (current === "other") s.other[s.other.length - 1]?.lines.push(line);
    else s[current].push(line);
  }
  return s;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const MONTH_RE = new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s+\\d{4}\\b`, "i");
const DATE = `(?:(?:${MONTHS})[a-z]*\\.?\\s+\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to|until)\\s*(${DATE}|present|current|now|date|ongoing)`, "i");
const YEAR_ONLY = /\b(19|20)\d{2}\b/;

/** "Sep 2023" → "2023-09"; "2023" stays "2023"; "Present" → "". */
function toMonth(value: string) {
  const v = value.trim();
  if (/present|current|now|date|ongoing/i.test(v)) return "";
  const m = new RegExp(`(${MONTHS})[a-z]*\\.?\\s+(\\d{4})`, "i").exec(v);
  if (m) {
    const idx = MONTHS.split("|").indexOf(m[1].toLowerCase().slice(0, 3) === "sep" ? "sep" : m[1].toLowerCase().slice(0, 3));
    return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
  }
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(v);
  if (slash) return `${slash[2]}-${slash[1].padStart(2, "0")}`;
  return v;
}

const isBullet = (l: string) => /^[•\-–*▪◦‣●o]\s+/.test(l) || /^\d+[.)]\s+/.test(l);
const stripBullet = (l: string) => l.replace(/^[•\-–*▪◦‣●o]\s+|^\d+[.)]\s+/, "").trim();

/** Experience entries: a block starts at a line carrying a date range. */
function parseExperience(lines: string[]): ProfileInput["experience"] {
  const out: ProfileInput["experience"] = [];
  let cur: ProfileInput["experience"][number] | null = null;
  let pendingTitle = "";
  for (const line of lines) {
    const range = RANGE_RE.exec(line);
    if (range && !isBullet(line)) {
      const rest = line.replace(range[0], "").replace(/[|,•·]+\s*$/, "").replace(/^\s*[|,•·]+/, "").trim();
      const parts = (pendingTitle ? `${pendingTitle} | ${rest}` : rest).split(/\s*[|•·]\s*|\s+at\s+|\s*,\s*(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
      cur = { title: parts[0] ?? "", employer: parts[1] ?? "", location: parts.slice(2).join(", "), start: toMonth(range[1]), end: toMonth(range[2]), current: toMonth(range[2]) === "", bullets: [] };
      out.push(cur);
      pendingTitle = "";
      continue;
    }
    if (!cur) {
      pendingTitle = pendingTitle ? `${pendingTitle} | ${line}` : line;
      continue;
    }
    if (isBullet(line)) cur.bullets.push(stripBullet(line));
    else if (cur.bullets.length === 0 && !cur.employer && line.length < 80) cur.employer = line;
    else if (cur.bullets.length === 0 && line.length < 60 && !cur.location) cur.location = line;
    else if (cur.bullets.length > 0 && !/[.!?]$/.test(cur.bullets[cur.bullets.length - 1]) && line.length > 20 && !isBullet(line)) cur.bullets[cur.bullets.length - 1] += ` ${line}`;
    else cur.bullets.push(line);
  }
  return out;
}

function parseEducation(lines: string[]): ProfileInput["education"] {
  const out: ProfileInput["education"] = [];
  let cur: ProfileInput["education"][number] | null = null;
  for (const line of lines) {
    const range = RANGE_RE.exec(line);
    const year = YEAR_ONLY.test(line);
    if ((range || year) && !isBullet(line)) {
      const start = range ? toMonth(range[1]).slice(0, 4) : (YEAR_ONLY.exec(line)?.[0] ?? "");
      const end = range ? toMonth(range[2]).slice(0, 4) : (line.match(/\b(19|20)\d{2}\b/g)?.pop() ?? "");
      const rest = line.replace(range ? range[0] : /\b(19|20)\d{2}\b(\s*(-|–|to)\s*\b(19|20)\d{2}\b)?/g, "").replace(/[|,•·]+\s*$/, "").trim();
      const parts = rest.split(/\s*[|•·]\s*|\s*,\s*/).map((p) => p.trim()).filter(Boolean);
      const degree = parts.find((p) => /\b(bsc|msc|ba|ma|mba|phd|beng|meng|degree|diploma|a[- ]levels?|gcse|hnd|certificate)\b/i.test(p)) ?? parts[0] ?? "";
      const institution = parts.find((p) => p !== degree && /\b(university|college|school|institute|academy)\b/i.test(p)) ?? parts.find((p) => p !== degree) ?? "";
      const grade = parts.find((p) => /\b(first|2:1|2:2|upper|lower|distinction|merit|pass|honours|\d+\s*%|grade|[A-C]\*?)\b/i.test(p) && p !== degree && p !== institution) ?? "";
      cur = { institution, qualification: degree, grade, start, end, notes: "" };
      out.push(cur);
    } else if (cur) {
      if (!cur.institution && /\b(university|college|school|institute)\b/i.test(line)) cur.institution = line;
      else if (!cur.grade && /\b(first|2:1|2:2|distinction|merit|honours)\b/i.test(line)) cur.grade = line;
      else cur.notes = cur.notes ? `${cur.notes} ${stripBullet(line)}` : stripBullet(line);
    } else {
      cur = { institution: "", qualification: line, grade: "", start: "", end: "", notes: "" };
      out.push(cur);
    }
  }
  return out;
}

function parseQualifications(lines: string[]): ProfileInput["qualifications"] {
  const out: ProfileInput["qualifications"] = [];
  let body = "";
  for (const raw of lines) {
    const line = stripBullet(raw);
    const bodyMatch = /\b(IFoA|Institute and Faculty of Actuaries|SOA|CAS|ACCA|CIMA|CFA|FRM|PRINCE2|PMP|CISI|CII|AAT|ICAEW)\b/i.exec(line);
    if (bodyMatch) body = bodyMatch[1].toUpperCase() === "INSTITUTE AND FACULTY OF ACTUARIES" ? "IFoA" : bodyMatch[1];
    // "CS1, CM1, CB1 (passed)" style lists → one row per code.
    const codes = line.match(/\b(C[SMBP]\d[A-Z]?|S[PA]\d|CT\d|CA\d|ST\d|CB\d|CP\d|Exam\s+[A-Z0-9]+)\b/gi);
    const status: ProfileInput["qualifications"][number]["status"] = /awaiting|pending|sat|result|sitting|booked|scheduled/i.test(line) ? "PENDING" : /plan|intend|next|to sit/i.test(line) ? "PLANNED" : "PASSED";
    const date = MONTH_RE.exec(line)?.[0] ?? "";
    if (codes && codes.length > 1) {
      for (const code of codes) out.push({ body, name: code.toUpperCase(), status, date });
    } else if (line.length > 2 && line.length < 140) {
      out.push({ body, name: line.replace(/\((passed|pending|awaiting results?)\)/i, "").trim(), status, date });
    }
  }
  return out;
}

function parseSkills(lines: string[]): ProfileInput["skills"] {
  const groups: ProfileInput["skills"] = [];
  for (const raw of lines) {
    const line = stripBullet(raw);
    const m = /^([A-Za-z &/]{2,40}):\s*(.+)$/.exec(line);
    const items = (m ? m[2] : line).split(/\s*[,;|•·]\s*/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length < 60);
    if (items.length === 0) continue;
    if (m) groups.push({ group: m[1].trim(), items });
    else if (groups.length && !groups[groups.length - 1].group) groups[groups.length - 1].items.push(...items);
    else groups.push({ group: "", items });
  }
  return groups.map((g) => ({ ...g, group: g.group || "Skills" }));
}

export function parseCvHeuristically(text: string, known: { firstName: string; lastName: string; email: string }): ParsedProfile {
  const s = splitSections(text);
  const all = text.replace(/\s+/g, " ");
  const phone = /(\+44\s?\d{2,4}|\(?0\d{3,4}\)?)[\s-]?\d{3,4}[\s-]?\d{3,4}/.exec(all)?.[0] ?? "";
  const contactEmail = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(all)?.[0]?.toLowerCase() ?? "";
  const withoutEmails = all.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, " ");
  const links = Array.from(withoutEmails.matchAll(/\b(?:https?:\/\/)?(?:www\.)?(linkedin\.com\/in\/[\w-]+|github\.com\/[\w-]+|[\w-]+\.(?:com|co\.uk|io|dev)\/?[\w-]*)\b/gi))
    .map((m) => m[0])
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 4)
    .map((url) => ({ label: /linkedin/i.test(url) ? "LinkedIn" : /github/i.test(url) ? "GitHub" : "Website", url: url.startsWith("http") ? url : `https://${url}` }));
  // The header holds the name, a headline and contact details, often several to a line.
  const segments = s.header.flatMap((l) => l.split(/\s*[|•·]\s*/)).map((x) => x.trim()).filter(Boolean);
  const LOCATION_RE = /\b(uk|united kingdom|london|england|scotland|wales|manchester|birmingham|leeds|edinburgh|glasgow|bristol|cardiff|belfast|remote)\b/i;
  const isContact = (x: string) => /@|\d{4,}|https?:|www\.|linkedin|github/i.test(x);
  const nameLine = segments.find((x) => !isContact(x) && x.split(/\s+/).length <= 4 && x.length < 40 && !LOCATION_RE.test(x)) ?? `${known.firstName} ${known.lastName}`;
  const [firstName, ...rest] = nameLine.replace(/[^A-Za-z' -]/g, "").trim().split(/\s+/);
  const location = segments.find((x) => x !== nameLine && !isContact(x) && LOCATION_RE.test(x) && x.length < 60) ?? "";
  const headline = segments.find((x) => x !== nameLine && x !== location && !isContact(x) && x.length > 10 && x.length < 120) ?? "";
  return {
    method: "HEURISTIC",
    firstName: firstName || known.firstName,
    lastName: rest.join(" ") || known.lastName,
    headline,
    summary: s.summary.join(" ").slice(0, 2000),
    phone: phone.trim(),
    contactEmail,
    location,
    links,
    qualifications: parseQualifications(s.qualifications),
    skills: parseSkills(s.skills),
    experience: parseExperience(s.experience),
    education: parseEducation(s.education),
    extraSections: s.other.map((o) => ({ title: o.title.replace(/^\w/, (c) => c.toUpperCase()).replace(/^([A-Z])([A-Z]+)$/, (_, a, b) => a + b.toLowerCase()), items: o.lines.map(stripBullet).filter(Boolean) })).filter((o) => o.items.length),
  };
}

// --- Claude ----------------------------------------------------------------

const short = z.string().max(200).default("");
const aiProfile = z.object({
  firstName: short,
  lastName: short,
  headline: short,
  summary: z.string().max(2000).default(""),
  phone: short,
  contactEmail: short,
  location: short,
  links: z.array(z.object({ label: short, url: z.string().max(500) })).max(10).default([]),
  qualifications: z.array(z.object({ body: short, name: short, status: z.enum(["PASSED", "PENDING", "PLANNED"]).default("PASSED"), date: short })).max(60).default([]),
  skills: z.array(z.object({ group: short, items: z.array(short).max(40) })).max(20).default([]),
  experience: z
    .array(z.object({ title: short, employer: short, location: short, start: short, end: short, current: z.boolean().default(false), bullets: z.array(z.string().max(600)).max(15).default([]) }))
    .max(20)
    .default([]),
  education: z.array(z.object({ institution: short, qualification: short, grade: short, start: short, end: short, notes: z.string().max(4000).default("") })).max(10).default([]),
  extraSections: z.array(z.object({ title: short, items: z.array(z.string().max(600)).max(20) })).max(8).default([]),
});

async function parseCvWithAi(text: string): Promise<ParsedProfile> {
  const { data } = await generateJson<unknown>({
    system: [
      "You convert the text of a CV into structured JSON for a profile editor. Copy facts exactly as written; do not invent, infer or embellish anything that isn't in the text. Leave a field empty when the CV doesn't say.",
      "Dates: experience start/end as YYYY-MM when a month is given, else YYYY; education start/end as YYYY. current=true for a role still held (then end is empty).",
      "qualifications: professional exams, certifications and memberships (not degrees), one per row, with body = the awarding body (e.g. IFoA), status PASSED / PENDING (result awaited or sat) / PLANNED, and date as written.",
      "skills: grouped as the CV groups them (e.g. Technical, Actuarial, Languages); a flat list becomes one group named Skills.",
      "experience bullets: the CV's own bullet points, one string each, most recent role first. extraSections: anything else (interests, volunteering, publications, awards, references).",
      'Reply with a single JSON object only, no markdown, exactly this shape: {"firstName","lastName","headline","summary","phone","contactEmail","location","links":[{"label","url"}],"qualifications":[{"body","name","status","date"}],"skills":[{"group","items":[]}],"experience":[{"title","employer","location","start","end","current","bullets":[]}],"education":[{"institution","qualification","grade","start","end","notes"}],"extraSections":[{"title","items":[]}]}',
    ].join(" "),
    user: text.slice(0, 30_000),
    // The upload request has ~25 s in all on Netlify; the section parser takes over if this runs out.
    budgetMs: 18_000,
  });
  return { method: "AI", ...aiProfile.parse(data) };
}

/** Reads a CV into profile fields: the AI provider when one is set, else the section parser. */
export async function parseCv(text: string, known: { firstName: string; lastName: string; email: string }): Promise<ParsedProfile> {
  if (aiAvailable()) {
    try {
      return await parseCvWithAi(text);
    } catch (error) {
      console.error("[cv-import] AI parsing failed, using the section parser", error);
    }
  }
  return parseCvHeuristically(text, known);
}
