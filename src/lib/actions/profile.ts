"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { firstIssue } from "@/lib/validation";
import type { FormState } from "./auth";

const short = z.string().trim().max(200);
const long = z.string().trim().max(4000);

const profileSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  headline: short,
  summary: z.string().trim().max(2000),
  phone: z.string().trim().max(40),
  location: short,
  links: z.array(z.object({ label: short, url: z.string().trim().max(500) })).max(10),
  qualifications: z
    .array(z.object({ body: short, name: short, status: z.enum(["PASSED", "PENDING", "PLANNED"]), date: short }))
    .max(60),
  skills: z.array(z.object({ group: short, items: z.array(short).max(40) })).max(20),
  experience: z
    .array(
      z.object({
        title: short,
        employer: short,
        location: short,
        start: short,
        end: short,
        current: z.boolean(),
        bullets: z.array(z.string().trim().max(600)).max(15),
      }),
    )
    .max(20),
  education: z.array(z.object({ institution: short, qualification: short, grade: short, start: short, end: short, notes: long })).max(10),
  extraSections: z.array(z.object({ title: short, items: z.array(z.string().trim().max(600)).max(20) })).max(8),
  availability: short,
  noticePeriod: short,
  salaryMin: z.number().int().min(0).max(10_000_000).nullable(),
  salaryMax: z.number().int().min(0).max(10_000_000).nullable(),
  salaryNote: short,
  rightToWork: long,
  visaExpiresAt: z.string().trim().max(10),
  aiTailoring: z.boolean(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/** Drops empty rows so the saved profile holds only what was filled in. */
function tidy(input: ProfileInput): ProfileInput {
  const nonEmpty = (s: string) => s.trim().length > 0;
  return {
    ...input,
    links: input.links.filter((l) => nonEmpty(l.url)),
    qualifications: input.qualifications.filter((q) => nonEmpty(q.name)),
    skills: input.skills.map((g) => ({ ...g, items: g.items.filter(nonEmpty) })).filter((g) => g.items.length > 0),
    experience: input.experience.map((e) => ({ ...e, bullets: e.bullets.filter(nonEmpty) })).filter((e) => nonEmpty(e.title) || nonEmpty(e.employer)),
    education: input.education.filter((e) => nonEmpty(e.institution) || nonEmpty(e.qualification)),
    extraSections: input.extraSections.map((s) => ({ ...s, items: s.items.filter(nonEmpty) })).filter((s) => nonEmpty(s.title) && s.items.length > 0),
  };
}

export async function saveProfile(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/profile");
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { error: "The form couldn't be read. Reload the page and try again." };
  }
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = tidy(parsed.data);
  const visa = data.visaExpiresAt ? new Date(data.visaExpiresAt) : null;
  const { firstName, lastName, visaExpiresAt: _visa, ...profile } = data;
  void _visa;
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { firstName, lastName } }),
    db.profile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...profile, visaExpiresAt: visa && !Number.isNaN(visa.getTime()) ? visa : null },
      update: { ...profile, visaExpiresAt: visa && !Number.isNaN(visa.getTime()) ? visa : null },
    }),
  ]);
  revalidatePath("/app", "layout");
  return { ok: "Profile saved." };
}
