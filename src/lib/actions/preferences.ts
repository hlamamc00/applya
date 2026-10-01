"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { JOB_LEVELS } from "@/lib/types";
import { int, list, str } from "@/lib/utils";
import { discoverSources } from "@/lib/jobs/discover";
import type { FormState } from "./auth";

export async function savePreferences(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/preferences");
  const levels = formData.getAll("levels").map(String).filter((l) => (JOB_LEVELS as readonly string[]).includes(l));
  const minScore = Math.min(100, Math.max(0, int(formData.get("minScore")) ?? 40));
  const data = {
    keywords: list(formData.get("keywords")),
    excludeKeywords: list(formData.get("excludeKeywords")),
    locations: list(formData.get("locations")),
    areas: list(formData.get("areas")),
    levels,
    minScore,
    dailyScan: formData.get("dailyScan") === "on",
    autoApprove: formData.get("autoApprove") === "on",
    autoSubmit: formData.get("autoSubmit") === "on",
    reviewEmails: formData.get("reviewEmails") === "on",
  };
  await db.preference.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  revalidatePath("/app", "layout");
  return { ok: "Preferences saved. The next scan will use them." };
}

/** Adds sources for the user's own keywords: keyword feeds now, web discovery when keys allow. */
export async function findSourcesForMe(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/preferences");
  const prefs = await db.preference.findUnique({ where: { userId: user.id } });
  const keywords = Array.isArray(prefs?.keywords) ? prefs!.keywords.map(String) : [];
  const field = str(formData.get("field")) || keywords[0] || "";
  if (!field) return { error: "Add a keyword or two first." };
  const report = await discoverSources({ field, keywords, userId: user.id, useWeb: true });
  revalidatePath("/app", "layout");
  const added = report.added.length ? `Added ${report.added.length} source${report.added.length === 1 ? "" : "s"}: ${report.added.map((a) => a.name).join(", ")}.` : "No new sources were found.";
  const skipped = report.alreadyThere.length ? ` ${report.alreadyThere.length} already in place.` : "";
  const notes = report.notes.length ? ` ${report.notes.join(" ")}` : "";
  return { ok: `${added}${skipped}${notes} Press Scan now under Matches to read them.` };
}
