import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { defaultPreferences } from "@/lib/defaults";
import { PageHeader } from "@/components/ui";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Job preferences" };

const strings = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export default async function PreferencesPage() {
  const user = await requireUser("/app/preferences");
  const prefs = (await db.preference.findUnique({ where: { userId: user.id } })) ?? (await db.preference.create({ data: { userId: user.id, ...defaultPreferences() } }));
  const sources = await db.jobSource.findMany({ where: { enabled: true }, orderBy: { name: "asc" }, select: { name: true, kind: true } });
  return (
    <>
      <PageHeader eyebrow="Job preferences" title="What to look for" intro="The scanner reads every enabled source daily and scores each advert against these preferences. Matches above your threshold appear under Matches; drafts are prepared for the strongest ones." />
      <PreferencesForm
        initial={{
          keywords: strings(prefs.keywords),
          excludeKeywords: strings(prefs.excludeKeywords),
          locations: strings(prefs.locations),
          areas: strings(prefs.areas),
          levels: strings(prefs.levels),
          minScore: prefs.minScore,
          dailyScan: prefs.dailyScan,
          autoApprove: prefs.autoApprove,
          autoSubmit: prefs.autoSubmit,
          reviewEmails: prefs.reviewEmails,
        }}
        sources={sources}
        showSources={user.role === "ADMIN"}
      />
    </>
  );
}
