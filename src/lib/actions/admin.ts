"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { runScan } from "@/lib/jobs/scan";
import { SOURCE_KINDS, type SourceKind } from "@/lib/types";
import { int, str } from "@/lib/utils";
import type { FormState } from "./auth";

export async function saveSource(_: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const id = str(formData.get("id"));
  const kind = str(formData.get("kind")) as SourceKind;
  const name = str(formData.get("name"));
  if (!SOURCE_KINDS.includes(kind)) return { error: "Choose a kind of source." };
  if (!name) return { error: "Give the source a name." };
  const config = {
    token: str(formData.get("token")) || undefined,
    query: str(formData.get("query")) || undefined,
    where: str(formData.get("where")) || undefined,
    days: int(formData.get("days")) ?? undefined,
    company: str(formData.get("company")) || undefined,
  };
  const isBoard = ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE"].includes(kind);
  if (isBoard && !config.token) return { error: "A board source needs the company's board token or slug." };
  if (!isBoard && !config.query) return { error: "A search source needs search terms." };
  const data = { kind, name, config, enabled: formData.get("enabled") !== "off" };
  if (id) {
    await db.jobSource.update({ where: { id }, data });
  } else {
    const existing = await db.jobSource.findUnique({ where: { kind_name: { kind, name } } });
    if (existing) return { error: "A source with that kind and name already exists." };
    await db.jobSource.create({ data });
  }
  revalidatePath("/admin", "layout");
  return { ok: "Source saved." };
}

export async function toggleSource(formData: FormData) {
  await requireAdmin();
  const id = str(formData.get("id"));
  const source = await db.jobSource.findUniqueOrThrow({ where: { id } });
  await db.jobSource.update({ where: { id }, data: { enabled: !source.enabled } });
  revalidatePath("/admin", "layout");
}

export async function deleteSource(formData: FormData) {
  await requireAdmin();
  await db.jobSource.delete({ where: { id: str(formData.get("id")) } });
  revalidatePath("/admin", "layout");
}

export async function adminScan(): Promise<FormState> {
  await requireAdmin();
  const s = await runScan("MANUAL");
  revalidatePath("/admin", "layout");
  return { ok: `${s.jobsFound} adverts read, ${s.jobsNew} new, ${s.matchesNew} new matches, ${s.draftsNew} drafts.${s.errors.length ? ` Errors: ${s.errors.join("; ")}` : ""}` };
}

export async function setRole(formData: FormData) {
  const admin = await requireAdmin();
  const id = str(formData.get("id"));
  const role = str(formData.get("role")) === "ADMIN" ? "ADMIN" : "USER";
  if (id === admin.id) return;
  await db.user.update({ where: { id }, data: { role } });
  revalidatePath("/admin/users");
}
