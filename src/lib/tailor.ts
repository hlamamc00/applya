import "server-only";
import { aiAvailable, generateJson, PROVIDER_LABELS, providerQueue } from "./llm";
import { z } from "zod";
import type { CvDocument } from "./cv";

// Adapts a profile to one job advert. With an AI provider configured (see
// llm.ts: Groq, Gemini, OpenRouter, Cloudflare or Anthropic) and the user's
// AI tailoring on, the model rewrites the summary and headline, picks the
// order of skills and bullets, and drafts a short cover message: facts stay
// as they are in the profile, only the emphasis changes. Without a key, a
// keyword pass does the reordering and fills in a plain-worded message.

export interface TailorInput {
  cv: CvDocument;
  job: { title: string; company: string; location: string; description: string };
  /** Facts for the message that never go into the prompt. */
  facts: { availability: string; noticePeriod: string; rightToWork: string; salaryNote: string };
}

export interface TailorOutput {
  cv: CvDocument;
  coverMessage: string;
  method: "AI" | "HEURISTIC";
}

const STOP = new Set("a an and the of to in for with on at by or as is are be we you your our this that from will can into across within about who what role job team work".split(" "));

/** Words worth matching from an advert, most frequent first. */
function keyTerms(text: string, limit = 40) {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) {
    if (STOP.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

const overlap = (text: string, terms: string[]) => terms.filter((t) => text.toLowerCase().includes(t)).length;

/** Reorders skills and bullets so what the advert asks for comes first. Facts are untouched. */
export function tailorHeuristically(input: TailorInput): TailorOutput {
  const terms = keyTerms(`${input.job.title} ${input.job.description}`);
  const cv = structuredClone(input.cv);
  cv.skills = cv.skills
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => overlap(b, terms) - overlap(a, terms)) }))
    .sort((a, b) => overlap(b.items.join(" "), terms) - overlap(a.items.join(" "), terms));
  cv.experience = cv.experience.map((e) => ({ ...e, bullets: [...e.bullets].sort((a, b) => overlap(b, terms) - overlap(a, terms)) }));
  const passed = cv.qualifications.filter((q) => q.status === "PASSED").length;
  const pending = cv.qualifications.filter((q) => q.status === "PENDING");
  const lines = [
    `Dear Hiring Team,`,
    ``,
    `I would like to apply for the ${input.job.title} role at ${input.job.company}.`,
    cv.summary,
    passed > 0
      ? `I have passed ${passed} professional exam${passed === 1 ? "" : "s"}${pending.length ? ` and am awaiting results for ${pending.map((q) => q.name).join(" and ")}` : ""}.`
      : "",
    [input.facts.availability && `Availability: ${input.facts.availability}.`, input.facts.noticePeriod && `Notice period: ${input.facts.noticePeriod}.`, input.facts.rightToWork && `Right to work: ${input.facts.rightToWork}`]
      .filter(Boolean)
      .join(" "),
    `My CV is attached. I would welcome the chance to discuss how I can contribute to your team.`,
    ``,
    `Kind regards,`,
    cv.name,
  ].filter((l) => l !== undefined);
  return { cv, coverMessage: lines.join("\n").replace(/\n{3,}/g, "\n\n"), method: "HEURISTIC" };
}

const aiResult = z.object({
  headline: z.string().max(200),
  summary: z.string().max(1500),
  skills: z.array(z.object({ group: z.string().max(200), items: z.array(z.string().max(200)).max(40) })).max(20),
  experienceBullets: z.array(z.array(z.string().max(600)).max(15)).max(20),
  coverMessage: z.string().max(3000),
});

export function aiTailoringAvailable() {
  return aiAvailable();
}

/** What the admin page shows: which services write the drafts, in order. */
export function aiTailoringLabel() {
  const q = providerQueue();
  return q.length ? q.map((p) => PROVIDER_LABELS[p].replace(/ \(.*\)$/, "")).join(" → ") : null;
}

/** Tailors with the AI provider; falls back to the keyword pass if none is set or the call fails. */
export async function tailor(input: TailorInput, options: { allowAi: boolean }): Promise<TailorOutput> {
  if (!options.allowAi || !aiTailoringAvailable()) return tailorHeuristically(input);
  try {
    return await tailorWithAi(input);
  } catch (error) {
    console.error("[tailor] AI tailoring failed, using the keyword pass", error);
    return tailorHeuristically(input);
  }
}

async function tailorWithAi(input: TailorInput): Promise<TailorOutput> {
  const { cv, job } = input;
  // Contact, salary and immigration details stay out of the prompt on purpose.
  const profile = {
    headline: cv.headline,
    summary: cv.summary,
    qualifications: cv.qualifications,
    skills: cv.skills,
    experience: cv.experience.map((e) => ({ title: e.title, employer: e.employer, start: e.start, end: e.current ? "present" : e.end, bullets: e.bullets })),
    education: cv.education,
    extraSections: cv.extraSections,
  };
  const facts = [
    input.facts.availability && `Availability: ${input.facts.availability}`,
    input.facts.noticePeriod && `Notice period: ${input.facts.noticePeriod}`,
    input.facts.rightToWork && `Right to work (mention only if the advert asks about eligibility or sponsorship): ${input.facts.rightToWork}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await generateJson<unknown>({
    system: [
      "You tailor a candidate's CV and cover message to one job advert for a UK application.",
      "Rules: never invent qualifications, employers, dates, results or figures; every claim must come from the profile given.",
      "Rewrite the headline and summary to lead with what this advert values. Reorder skill groups and the items inside them, and reorder each role's bullets, so the most relevant come first; you may tighten wording but keep each bullet's facts. Return every role's bullets in the same role order as given.",
      "The cover message is 150–220 words, British English, plain and confident, addressed 'Dear Hiring Team' unless the advert names someone, signed with the candidate's name. Mention availability or notice period only if given. Do not mention salary.",
      'Reply with a single JSON object only, no markdown, exactly this shape: {"headline": string, "summary": string, "skills": [{"group": string, "items": string[]}], "experienceBullets": string[][] (one array per role, same order as the profile), "coverMessage": string}',
    ].join(" "),
    user: [
      `Job title: ${job.title}`,
      `Employer: ${job.company}`,
      `Location: ${job.location || "not stated"}`,
      `Advert:\n${job.description.slice(0, 7_000)}`,
      ``,
      `Candidate name: ${cv.name}`,
      `Profile (JSON):\n${JSON.stringify(profile)}`,
      facts ? `\nFacts for the message:\n${facts}` : "",
    ].join("\n"),
    budgetMs: 40_000,
  });
  const parsed = aiResult.parse(data);

  // The model only chooses order and wording of the parts it was asked to;
  // anything it drops is kept from the profile so no fact disappears.
  const out = structuredClone(cv);
  out.headline = parsed.headline || cv.headline;
  out.summary = parsed.summary || cv.summary;
  const knownSkills = new Set(cv.skills.flatMap((g) => g.items.map((s) => s.toLowerCase())));
  const returned = parsed.skills.map((g) => ({ group: g.group, items: g.items.filter((s) => knownSkills.has(s.toLowerCase())) })).filter((g) => g.items.length);
  const mentioned = new Set(returned.flatMap((g) => g.items.map((s) => s.toLowerCase())));
  const leftover = cv.skills.map((g) => ({ group: g.group, items: g.items.filter((s) => !mentioned.has(s.toLowerCase())) })).filter((g) => g.items.length);
  out.skills = returned.length ? [...returned, ...leftover] : cv.skills;
  out.experience = cv.experience.map((e, i) => {
    const bullets = parsed.experienceBullets[i];
    return bullets && bullets.length > 0 ? { ...e, bullets } : e;
  });
  return { cv: out, coverMessage: parsed.coverMessage.trim(), method: "AI" };
}
