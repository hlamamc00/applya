"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { JOB_LEVELS } from "@/lib/types";
import { int, list } from "@/lib/utils";
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
    reviewEmails: formData.get("reviewEmails") === "on",
  };
  await db.preference.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  revalidatePath("/app", "layout");
  return { ok: "Preferences saved. The next scan will use them." };
}
