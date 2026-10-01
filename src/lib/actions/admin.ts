"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { startScan } from "@/lib/jobs/scan";
import { discoverSources } from "@/lib/jobs/discover";
import { list } from "@/lib/utils";
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
    url: str(formData.get("url")) || undefined,
    token: str(formData.get("token")) || undefined,
    query: str(formData.get("query")) || undefined,
    where: str(formData.get("where")) || undefined,
    days: int(formData.get("days")) ?? undefined,
    company: str(formData.get("company")) || undefined,
  };
  const isBoard = ["GREENHOUSE", "LEVER", "ASHBY", "WORKABLE"].includes(kind);
  if (isBoard && !config.token) return { error: "A board source needs the company's board token or slug." };
  if (kind === "RSS" && !config.url) return { error: "A feed source needs the feed URL." };
  if (!isBoard && kind !== "RSS" && !config.query) return { error: "A search source needs search terms." };
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
  const result = await startScan("MANUAL");
  revalidatePath("/admin", "layout");
  if (!result.started) return { error: result.message };
  const s = result.summary;
  return { ok: s ? `${result.message}${s.errors.length ? ` Errors: ${s.errors.join("; ")}` : ""}` : result.message };
}

export async function setRole(formData: FormData) {
  const admin = await requireAdmin();
  const id = str(formData.get("id"));
  const role = str(formData.get("role")) === "ADMIN" ? "ADMIN" : "USER";
  if (id === admin.id) return;
  await db.user.update({ where: { id }, data: { role } });
  revalidatePath("/admin/users");
}

function describe(report: Awaited<ReturnType<typeof discoverSources>>) {
  const parts = [
    report.added.length ? `Added ${report.added.length}: ${report.added.map((a) => `${a.name} (${a.jobs} adverts)`).join(", ")}.` : "Nothing new was added.",
    report.alreadyThere.length ? `Already there: ${report.alreadyThere.join(", ")}.` : "",
    report.rejected.length ? `Didn't work: ${report.rejected.map((r) => `${r.name} – ${r.reason}`).join("; ")}.` : "",
    ...report.notes,
  ];
  return parts.filter(Boolean).join(" ");
}

/** Admin → "Find sources for a field". */
export async function adminDiscover(_: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const field = str(formData.get("field"));
  const keywords = list(formData.get("keywords"));
  if (!field && keywords.length === 0) return { error: "Say what field to look for." };
  const report = await discoverSources({ field, keywords: keywords.length ? keywords : [field], where: str(formData.get("where")) || undefined, userId: admin.id, useWeb: formData.get("web") === "on" });
  revalidatePath("/admin", "layout");
  return { ok: describe(report) };
}
