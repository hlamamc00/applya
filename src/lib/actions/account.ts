"use server";

import { requireUser, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { firstIssue, passwordSchema } from "@/lib/validation";
import type { FormState } from "./auth";

export async function changePassword(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/app/settings");
  const current = String(formData.get("current") ?? "");
  const next = passwordSchema.safeParse(formData.get("password"));
  if (!next.success) return { error: firstIssue(next.error) };
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(current, row.passwordHash))) return { error: "Your current password isn't right." };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next.data) } });
  return { ok: "Password changed." };
}
